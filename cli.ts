
/***** IMPORTS *****/

import app                 from './app.ts'
import constants           from './constants.ts'
import { message }         from './messages.ts'
import * as CantContinue   from './cant continue.ts'
import {
    style,
    lineBreak,
    preview,
    print,
    selectOneOf,
    selectPaths,
    selectOptions,
    renderTable,
    renderFsTreeFromPaths
}                          from './terminal.ts'
import { path }            from './deps.ts'

import type { AppOptions } from './app.ts'


/***** TYPES *****/

type ReadyFun        = AppOptions['ready']
type ReportErrorFun  = AppOptions['reportError']
type ShowProgressFun = AppOptions['showProgress']
type ShowSummaryFun  = AppOptions['showSummary']


/***** STATE *****/

const underwayOptimizations : Record<string, string> = {}
let maxUnderwayOptimizations = 0
const failedOptimizationMessages = new Array<string>


/***** ENTRYPOINT *****/

const cwd = Deno.cwd()
await app({ cwd, ready, reportError, showProgress, showSummary })


/***** IMPLEMENTATION *****/

ready satisfies ReadyFun
async function ready(
    ...[ sourcePaths, options ] : Parameters<ReadyFun>
) : ReturnType<ReadyFun> {
    
    let pathMask = new Array<boolean>(sourcePaths.length).fill(true)
    
    print(['\n'])
    await menu()
    
    return {
        selectedImages:
            sourcePaths
            .filter((_, i) => pathMask[i]),
        
        widths:
            options.widths
            .filter(({ enabled }) => enabled)
            .map(({ width }) => width),
        
        formats:
            Object.entries(options.formats)
            .filter(([ _, { enabled } ]) => enabled)
            .map(([ format, { codec, quality } ]) => ({ codec, format: format as keyof typeof options.formats, quality }))
    }

    function summary() {
        const selectedImages = sourcePaths.filter((_, i) => pathMask[i])
        const uniqueFolders = new Set(selectedImages.map(path.dirname))
        return message('ReadyToOptimize', {
            imageCount : String(selectedImages.length),
            folderCount: String(uniqueFolders.size)
        })
    }

    function fsTree() {
        const imagePaths =
            sourcePaths
            .filter((_, i) => pathMask[i])
            .map(p => path.relative(cwd, p))
        
        return renderFsTreeFromPaths(imagePaths, path.sep)
    }

    async function menu() : Promise<void> {
        const action = await selectOneOf(summary() + '\n\n' + fsTree(), [
            message('StartOptimizing'),
            message('PickImages'),
            message('Configure'),
            message('Exit')
        ])
        if (action === 0) return
        if (action === 1) return pickImages()
        if (action === 2) return configure()
        if (action === 3) Deno.exit()
    }

    async function pickImages() {
        const instructions = message('InteractionInstructions')
        pathMask = await selectPaths(
            instructions,
            sourcePaths.map(sourcePath => path.relative(cwd, sourcePath)),
            path.sep,
            pathMask
        )
        return menu()
    }

    async function configure() {
        const instructions = message('InteractionInstructions')
        const widthsNote = message('NoteAboutWidths')
        options = await selectOptions(instructions + '\n\n' + widthsNote, options)
        return menu()
    }
}

reportError satisfies ReportErrorFun
async function reportError(
    cantContinue : Parameters<ReportErrorFun>[0],
) : Promise<unknown> {
    const { packageName } = constants
    
    if (cantContinue instanceof CantContinue.CouldntFindAstroConfigFile) {
        return print([
            lineBreak(),
            message('CouldntFindAstroConfigFile', {
                checkedPaths:
                    cantContinue.checkedPaths
                    .map((path, i) => ' ' + String(i + 1) + ') ' + path)
                    .join('\n')
            }),
            lineBreak()
        ])
    }

    if (cantContinue instanceof CantContinue.CouldntConnectToInternet) {
        const { error, url } = cantContinue
        return print([
            lineBreak(),
            message('CouldntConnectToInternet', {
                url,
                message: style.red(error.message)
            }),
            lineBreak()
        ])
    }

    if (cantContinue instanceof CantContinue.FfmpegNotAvailableForPlatform) {
        return print([
            lineBreak(),
            message('FfmpegNotAvailableForPlatform', {
                packageName,
                platform: style.red(cantContinue.platform),
                availablePlatforms: cantContinue.availablePlatforms.map(x => style.blue(x)).join(', ')
            }),
            lineBreak()
        ])
    }

    if (cantContinue instanceof CantContinue.CouldntDownloadFfmpeg) {
        return print([
            lineBreak(),
            message('CouldntDownloadFfmpeg', {
                packageName,
                response: await serializeResponse(cantContinue.response),
                url: style.blue(cantContinue.url)
            }),
            lineBreak()
        ])
    }

    if (cantContinue instanceof CantContinue.CouldntWriteFfmpegToDisk) {
        return print([
            lineBreak(),
            message('CouldntWriteFfmpegToDisk', {
                packageName,
                error: style.red(cantContinue.error.message),
                writingAt: style.blue(cantContinue.writingAt)
            }),
            lineBreak()
        ])
    }

    if (cantContinue instanceof CantContinue.CouldntParseImageInfo) {
        const { path, command, output } = cantContinue
        return print([
            lineBreak(),
            message('CouldntParseImageInfo', { path, command, output }),
            lineBreak()
        ])
    }

    if (cantContinue instanceof CantContinue.CouldntTranscodeImage) {
        const { errorLine, sourcePath, log } = cantContinue
                    
        const tempFilePath = await Deno.makeTempFile({ suffix: '.txt' })
        const tempFileHandler = await Deno.open(tempFilePath, { write: true })
        
        await log.pipeThrough(new TextEncoderStream).pipeTo(tempFileHandler.writable)

        failedOptimizationMessages.push(
            message('CouldntTranscodeImage', {
                path         : style.blue(path.relative(cwd, sourcePath)),
                output       : style.stripColor.red(errorLine),
                logWrittenTo : style.blue(tempFilePath)
            })
        )

        const line = lineBreak()

        return globalThis.onunload ??= () =>
            print([
                line,
                ...failedOptimizationMessages.flatMap(message => [ message, line ]),
                message('NoteAboutFailedOptimizations', { packageName }),
                line
            ])
    }
    throw new Error('reportError() called with invalid arguments', { cause: arguments })
}


showProgress satisfies ShowProgressFun
async function showProgress(
    ...[ sourcePath, progress, remainingCount ] : Parameters<ShowProgressFun>
) : Promise<void> {

    await progress.pipeTo(new WritableStream({
        write({ destinationPath }) {
            render(underwayOptimizations[sourcePath] = destinationPath)
        },
        close() {
            render(delete underwayOptimizations[sourcePath])
        }
    }))

    function render(_ ?: unknown) {
        
        const remaining = message('RemainingCount', { remainingCount: String(remainingCount) })
        
        maxUnderwayOptimizations =
            Math.max(maxUnderwayOptimizations, Object.keys(underwayOptimizations).length)
        
        const halfWidth = Math.floor(Deno.consoleSize().columns / 2)

        const extraRows =
            Array<''>(maxUnderwayOptimizations - Object.keys(underwayOptimizations).length).fill('')
        
        const progress =
            Object.entries(underwayOptimizations)
            .map(([ source, destination ]) => {
                
                const sourcePath = path.relative(cwd, source)
                const destinationPath = path.relative(cwd, destination)
                
                const truncatedSourcePath =
                    (sourcePath.length + 3) > halfWidth
                        ? '...' + sourcePath.slice(sourcePath.length + 3 - halfWidth)
                        : sourcePath.padEnd(halfWidth, ' ')
                
                const truncatedDestinationPath =
                    (destinationPath.length + 3) > halfWidth
                        ? '...' + destinationPath.slice(destinationPath.length + 3 - halfWidth)
                        : destinationPath.padEnd(halfWidth, ' ')

                return truncatedSourcePath + ' => ' + truncatedDestinationPath
            })
                
        preview(progress.concat(extraRows).concat([remaining]))
    }
}

showSummary satisfies ShowSummaryFun
function showSummary(
    ...[ image, tasks ] : Parameters<ShowSummaryFun>
) {
    const title   = path.relative(cwd, image.path) + ' (' + readableFileSize(image.stat.size) + ')'
    const formats = Array.from(new Set(tasks.map(task => task.format)))
    const header  = [ 'Widths╲Formats', ...formats.map(String) ]
    
    const widths = iife(_ => {
        
        const allWidths =
            tasks
            .filter(task => task.type !== 'preview')
            .map(task => task.width)
        
        const uniqueWidths = Array.from(new Set(allWidths))
        
        return uniqueWidths.sort((a, b) => a - b)
    })
    
    const rows = widths.map(width => [
        String(width),
        ...formats.map(format => {
            const task = tasks.find(task => task.format === format && task.width === width)
                    
            if (
                task === undefined ||
                !('stat' in task) ||
                typeof task.stat !== 'object' ||
                !('size' in task.stat) ||
                typeof task.stat.size !== 'number'
            )
                return style.red('failed')

            if (task.stat.size === 0) 
                throw new Error('Unexpected: task.stat.size === 0')

            const relativeSize = task.stat.size / image.stat.size
            const smaller = relativeSize < 1

            const classes = {
                green: task.new && smaller,
                red  : task.new && !smaller,
                dim  : task.new !== true
            }

            const fileSizeText = readableFileSize(task.stat.size)

            const savingsText =
                smaller
                    ? '⇩ ' + ((1 - relativeSize) * 100).toFixed(0) + '%'
                    : '⇧ ' + ((relativeSize - 1) * 100).toFixed(0) + '%'
            
            return style(fileSizeText, classes) + '\n' + style(savingsText, classes)
        })
    ])

    print([
        '\n',
        title,
        renderTable([ header, ...rows ]),
        '\n'
    ])
}


/***** UTILITY FUNCTIONS *****/

function readableFileSize(size : number) {
    const scales = ['b', 'kb', 'mb', 'gb']
    const scale = Math.floor(Math.log(size) / Math.log(1024))
    const lessPrecise = parseFloat((size / Math.pow(1024, scale)).toFixed(1))
    return lessPrecise.toFixed(lessPrecise % 1 === 0 ? 0 : 1) + scales[scale]
}

async function serializeResponse(response : Response) {
    const headers = Array.from(response.headers).map(([key, value]) => `${key}: ${value}`)
    const body = await response.text()
    return `${response.url}\n${response.status} ${response.statusText}\n${headers.join('\n')}\n\n${body}`
}

function iife<A>(fun: (...args: unknown[]) => A): A {
    return fun()
}
