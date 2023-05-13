
/***** IMPORTS *****/

import app                 from './app.ts'
import constants           from './constants.ts'
import messages            from './messages.ts'
import * as CantContinue   from './cant continue.ts'
import {
    style,
    lineBreak,
    preview,
    print,
    selectOneOf,
    selectPaths,
    selectEncodingOptions,
    renderTable,
    renderFsTreeFromPaths
}                          from './terminal.ts'
import { path }            from './deps.ts'

import type { AppOptions, TranscodeOptions } from './app.ts'
import type { HOT }                          from './deps.ts'


/***** TYPES *****/

type Messages  = typeof messages
type ReadyFun  = AppOptions['ready']
type ReportFun = AppOptions['report']
type ShowFun   = AppOptions['show']


/***** ENTRYPOINT *****/

const cwd = Deno.cwd()
await app({ cwd , ready, report, show })


/***** IMPLEMENTATION *****/

ready satisfies ReadyFun
async function ready(
    images : Parameters<ReadyFun>[0]
) : ReturnType<ReadyFun> {
    
    let pathMask = new Array<boolean>(images.length).fill(true)
    let options : TranscodeOptions = structuredClone(constants.transcoding)
    
    const sourcePaths = images.map(image => image.path)
    
    print(['\n'])
    await menu()
    
    return {
        selectedImages: images.filter((_, i) => pathMask[i]),
        transcodeOptions: options
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
            message('Start optimizing'),
            message('Pick images'),
            message('Configure'),
            message('Exit')
        ])
        if (action === 0) return
        if (action === 1) return pickImages()
        if (action === 2) return configure()
        if (action === 3) Deno.exit()
    }

    async function pickImages() {
        const instructions = message('Interaction instructions')
        pathMask = await selectPaths(
            instructions,
            sourcePaths.map(sourcePath => path.relative(cwd, sourcePath)),
            path.sep,
            pathMask
        )
        return menu()
    }

    async function configure() {
        options = await selectEncodingOptions('Configure', options)
        return menu()
    }
}

report satisfies ReportFun
async function report(
    cantContinue : Parameters<ReportFun>[0]
) : Promise<void> {
    const { projectName } = constants
    
    if (cantContinue instanceof CantContinue.CouldntFindAstroConfigFile) {
        print([
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
        print([
            message('CouldntConnectToInternet', {
                url,
                message: style.red(error.message)
            }),
            lineBreak()
        ])
    }

    if (cantContinue instanceof CantContinue.CouldntDownloadFfmpeg) {
        print([
            message('CouldntDownloadFfmpeg', {
                projectName,
                response: await serializeResponse(cantContinue.response)
            }),
            lineBreak()
        ])
    }

    if (cantContinue instanceof CantContinue.CouldntWriteFfmpegToDisk) {
        print([
            message('CouldntWriteFfmpegToDisk', {
                projectName,
                error : style.red(cantContinue.error.message)
            }),
            lineBreak()
        ])
    }

    if (cantContinue instanceof CantContinue.CouldntParseImageInfo) {
        const { path, command, output } = cantContinue
        print([
            message('CouldntParseImageInfo', { path, command, output }),
            lineBreak()
        ])
    }

    if (cantContinue instanceof CantContinue.CouldntTranscodeImage) {
        const { errorLine, command, sourcePath } = cantContinue
                    
        // (async () => {
        //     const [ tempFile, log ] = await Promise.all([Deno.makeTempFile({ suffix: '.txt' }), fullLog])
        //     await Deno.writeTextFile(tempFile, log)
        //     print([ 'Full error log for ' + path.relative(cwd, sourcePath) + ' written to ' + tempFile ])
        // })()

        print([
            message('CouldntTranscodeImage', {
                path   : style.blue(sourcePath),
                command: style.yellow(command),
                output : style.red(errorLine)
            }),
            lineBreak()
        ])
    }
    throw new Error('report() called with invalid arguments', { cause: arguments })
}

show satisfies ShowFun
async function show(
    optimizationProgress : Parameters<ShowFun>[0]
) : Promise<void> {
    
    if ('progress' in optimizationProgress){
        
        const { sourcePath, progress, previouslyTranscoded, transcodingTargets } = optimizationProgress

        const global = globalThis as Record<symbol, Record<string, string>>

        // this is added onto global because it needs to be shared across multiple invocations of this function
        const underwayOptimizations = global[Symbol.for('underway optimizations')] ??= {}

        await progress.pipeTo(new WritableStream({
            write({ destinationPath }) {

                underwayOptimizations[sourcePath] = destinationPath
                
                const progressMessages =
                    Object.keys(underwayOptimizations)
                    .map(sourcePath => sourcePath + ' => ' + underwayOptimizations[sourcePath] + '\n')
                
                preview(progressMessages)
            },
            async close() {
                
                delete underwayOptimizations[sourcePath]

                const progressMessages =
                    Object.keys(underwayOptimizations)
                    .map(sourcePath => sourcePath + ' => ' + underwayOptimizations[sourcePath] + '\n')
            
                preview(progressMessages)

                const prev =
                    previouslyTranscoded.map(async task => ({
                        ...task,
                        size: (await safeStat(task.destinationPath))?.size,
                        new : false
                    }))

                const current =
                    transcodingTargets.map(async task => ({
                        ...task,
                        size: (await safeStat(task.destinationPath))?.size,
                        new : true
                    }))

                const [ sourceFileSize, prevTasks, currentTasks ] = await Promise.all([
                    safeStat(sourcePath).then(stat => stat!.size),
                    Promise.all(prev),
                    Promise.all(current)
                ])

                const title   = path.relative(cwd, sourcePath) + ' (' + readableFileSize(sourceFileSize) + ')'
                const tasks   = prevTasks.concat(currentTasks)
                const formats = Array.from(new Set(tasks.map(task => task.format)))
                const widths  = Array.from(new Set(tasks.map(task => task.width)))
                const header  = [ 'Widths\\Formats', ...formats.map(String) ]
                const rows    = widths.map(width => [
                    String(width),
                    ...formats.map(format => {
                        
                        const task = tasks.find(task => task.format === format && task.width === width)!
                        
                        if (task.size === undefined)
                            return style.red('failed')

                        const delta = task.size / sourceFileSize
                        const smaller = delta < 1

                        const classes = {
                            green: task.new && smaller,
                            red  : task.new && !smaller,
                            dim  : !task.new
                        }

                        const fileSizeText = readableFileSize(task.size)

                        const savingsText =
                            smaller
                                ? '⇩ ' + ((1 - delta) * 100).toFixed(0) + '%'
                                : '⇧ ' + ((delta - 1) * 100).toFixed(0) + '%'
                        
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
        }))
    }

    else {
        const { sourcePath, previouslyTranscoded } = optimizationProgress
        print([
            message('AlreadyOptimized', {
                path : path.relative(cwd, sourcePath),
                count: String(previouslyTranscoded.length)
            }),
            lineBreak()
        ])
    }
}


/***** TYPED MESSAGE TEMPLATES *****/

function message<Topic extends keyof Messages>(
    topic   : Topic,
    details : Params<Messages[Topic]['en-US']> = {}
) : string {
    const template : string =
        messages[topic][navigator.language as 'en-US'] ??
        // fallback to english
        messages[topic]['en-US']
    
    const message =
        Object.entries(details as Record<string, string>)
        .reduce(( mes, [ key, value ] ) => mes.replace(`{${key}}`, value), template)
        
    return message
}


/***** UTILITY FUNCTIONS *****/

async function safeStat(path : string | URL) {
    try {
        return await Deno.stat(path)
    }
    catch (error) {
        if (error instanceof Deno.errors.NotFound)
            return null
        else
            throw error
    }
}

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


/***** UTILITY TYPES *****/

type Params<Template> = Record<Variables<Template>, string>

type Variables<Template> =
    HOT.Pipe<
        Template,
        [
            HOT.Strings.Split<'{'>,
            HOT.Tuples.Tail,
            HOT.Tuples.Map<HOT.Strings.Split<'}'>>,
            HOT.Tuples.Map<HOT.Tuples.Head>,
            HOT.Tuples.ToUnion
        ]
    >

/**
 * Creates a deep copy of a given value using the structured clone algorithm.
 *
 * Unlike a shallow copy, a deep copy does not hold the same references as the
 * source object, meaning its properties can be changed without affecting the
 * source. For more details, see
 * [MDN](https://developer.mozilla.org/en-US/docs/Glossary/Deep_copy).
 *
 * Throws a `DataCloneError` if any part of the input value is not
 * serializable.
 *
 * @example
 * ```ts
 * const object = { x: 0, y: 1 };
 *
 * const deepCopy = structuredClone(object);
 * deepCopy.x = 1;
 * console.log(deepCopy.x, object.x); // 1 0
 *
 * const shallowCopy = object;
 * shallowCopy.x = 1;
 * // shallowCopy.x is pointing to the same location in memory as object.x
 * console.log(shallowCopy.x, object.x); // 1 1
 * ```
 *
 * @category DOM APIs
 */
declare function structuredClone<SourceType extends Serializable>(source : SourceType, options?: StructuredSerializeOptions) : Mutable<SourceType>

type Serializable =
    | string
    | number
    | boolean
    | null
    | undefined
    | Serializable[]
    | { [key : string | number] : Serializable }
    | readonly Serializable[]
    | { readonly [key : string | number] : Serializable }

type Mutable<A> = {
    -readonly [K in keyof A]: Mutable<A[K]>
}

