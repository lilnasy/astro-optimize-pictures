
/***** IMPORTS *****/

import app                 from './app.ts'
import constants           from './constants.ts'
import messages            from './messages.ts'
import * as CantContinue   from './cant continue.ts'
import {
    style,
    lineBreak,
    print,
    selectOneOf,
    selectPaths,
    selectEncodingOptions,
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
    
    const paths = images.map(image => image.path)
    
    await menu()
    
    return {
        selectedImages: images.filter((_, i) => pathMask[i]),
        transcodeOptions: options
    }

    function summary() {
        const selectedImages = paths.filter((_, i) => pathMask[i])
        const folderCount = String(new Set(selectedImages.map(p => {
            const pathParts = p.split(path.sep)
            pathParts.pop()
            return pathParts.join(path.sep)
        })).size)
        const imageCount = String(selectedImages.length)
        return message('ReadyToOptimize', { folderCount, imageCount })
    }

    function fsTree() {
        const imagePaths =
            paths
            .filter((_, i) => pathMask[i])
            .map(p => path.relative(cwd, p))
        
        return renderFsTreeFromPaths(imagePaths, path.sep)
    }

    async function menu() : Promise<void> {
        const action = await selectOneOf(summary() + '\n\n' + fsTree(), [
            message('Start optimizing'),
            message('Pick images'),
            message('Configure')
        ])
        if (action === 0) return
        if (action === 1) return pickImages()
        if (action === 2) return configure()
    }

    async function pickImages() {
        const instructions = message('Interaction instructions')
        pathMask = await selectPaths(
            instructions,
            paths.map(p => path.relative(cwd, p)),
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
        const checkedPaths = cantContinue.checkedPaths.map((path, i) => ' ' + String(i + 1) + ') ' + path).join('\n')
        print([
            message('CouldntFindAstroConfigFile', { checkedPaths }),
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
    
    if ('progress' in optimizationProgress)
        return await showUnderwayOptimization(optimizationProgress)

    else
        return showCachedOptimization(optimizationProgress)
}

async function showUnderwayOptimization({
    sourcePath,
    progress,
    // previouslyTranscoded,
    // transcodingTargets
} : Extract<Parameters<ShowFun>[0], { progress: unknown }>) {
    await progress.pipeTo(new WritableStream({
        write({ destinationPath }) {
            const optimizationMessage =
                'optimized ' +
                path.relative(cwd, sourcePath) +
                ' to ' +
                style.green(path.relative(cwd, destinationPath))
            print([ optimizationMessage ])
        },
        close() {
            // print a table of all the targets with an indicator of file size saved
        }
    }))
}

function showCachedOptimization({
    sourcePath,
    previouslyTranscoded,
} : Exclude<Parameters<ShowFun>[0], { progress: unknown } | Error>) {    
    print([
        message('AlreadyOptimized', {
            path : sourcePath,
            count: String(previouslyTranscoded.length)
        })
    ])
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