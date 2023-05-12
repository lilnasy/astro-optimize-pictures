
/***** IMPORTS *****/

import app                 from './app.ts'
import constants           from './constants.ts'
import messages            from './messages.ts'
import Deferred            from './deferred.ts'     
import * as CantContinue   from './cant continue.ts'
import {
    print,
    selectOneOf,
    selectPaths,
    selectEncodingOptions,
    renderFsTreeFromPaths,
style
}                          from './terminal.ts'
import { path }            from './deps.ts'

import type { AppOptions, TranscodeOptions } from './app.ts'
import type { HOT }                          from './deps.ts'


/***** TYPES *****/

type Messages = typeof messages
type ReadyFun = AppOptions['ready']
type ShowFun  = AppOptions['show']
type ExitFun  = AppOptions['exit']

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
await app({ cwd , ready, show, exit })


/***** IMPLEMENTATION *****/

show satisfies ShowFun
async function show(
    optimizationProgress : Parameters<ShowFun>[0]
) : Promise<void> {
    if (optimizationProgress instanceof Error) {
        const { path, command, output } = optimizationProgress
        const failedToParseMessage = message('CouldntParseImageInfo', { path, command, output })
        print([ failedToParseMessage ])
        return
    }
    if ('progress' in optimizationProgress) {
        const { previouslyTranscoded, transcodingTargets, progress, sourcePath } = optimizationProgress
        const completedTranscodes: boolean[] = Array(transcodingTargets.length).fill(false)
        const { size } = await Deno.stat(sourcePath)

        let transcodingComplete = new Deferred<void>

        await progress.pipeTo(new WritableStream({
            async write(transcodeTask) {
                if (transcodeTask instanceof Error) {
                    const { errorLine, command, fullLog } = transcodeTask;
                    
                    (async () => {
                        const [ tempFile, log ] = await Promise.all([Deno.makeTempFile({ suffix: '.txt' }), fullLog])
                        await Deno.writeTextFile(tempFile, log)
                        print([ 'Full error log for ' + path.relative(cwd, sourcePath) + ' written to ' + tempFile ])
                    })()
                    
                    const failedToTranscodeMessage = message('CouldntTranscodeImage', {
                        path   : style.blue(sourcePath),
                        command: style.yellow(command),
                        output : style.red(errorLine)
                    })
                    return print([ failedToTranscodeMessage ])
                }

                const { destinationPath, fullLog } = transcodeTask

                const i = transcodingTargets.findIndex(({ path }) => path === destinationPath)
                completedTranscodes[i] = true

                transcodingComplete.then(() => {
                    Deno.stat(destinationPath)
                    .then(({ size: targetSize }) => {
                        print([destinationPath + 'target size succesfully statted: ' + style.green(String(targetSize))])
                    })
                    .catch(error => {
                        print([destinationPath + 'failed to stat target size: ' + style.red(error.message)])
                    })
                })

                const optimizationMessage = 'optimized ' + path.relative(cwd, sourcePath) + ' to ' + style.green(path.relative(cwd, destinationPath))
                print([ optimizationMessage ])
            },
            close() {
                transcodingComplete.resolve()
            }
        }))
    }
    else {
        const { previouslyTranscoded, sourcePath } = optimizationProgress
        const message = 'already optimized ' + path.relative(cwd, sourcePath) + ' to ' + previouslyTranscoded.length + ' variants'
        return print([ message ])
    }

} /* implements ShowFun */

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
} /* implements ReadyFun */

exit satisfies ExitFun
async function exit(
    cantContinue : Parameters<ExitFun>[0]
) {
    const { projectName } = constants
    
    if (cantContinue instanceof CantContinue.CouldntFindAstroConfigFile) {
        const checkedPaths = cantContinue.checkedPaths.map((path, i) => ' ' + String(i + 1) + ') ' + path).join('\n')
        const exitMessage = message('CouldntFindAstroConfigFile', { checkedPaths })
        print([ exitMessage ])
        return Deno.exit()
    }

    if (cantContinue instanceof CantContinue.CouldntConnectToInternet) {
        const { error, url } = cantContinue
        const exitMessage = message('CouldntConnectToInternet', { url, message: error.message })
        print([ exitMessage ])
        return Deno.exit()
    }

    if (cantContinue instanceof CantContinue.CouldntDownloadFfmpeg) {
        const response = await serializeResponse(cantContinue.response)
        const exitMessage = message('CouldntDownloadFfmpeg', { projectName, response })
        print([ exitMessage ])
        return Deno.exit()
    }

    if (cantContinue instanceof CantContinue.CouldntWriteFfmpegToDisk) {
        const error = String(cantContinue.error)
        const exitMessage = message('CouldntWriteFfmpegToDisk', { projectName, error })
        print([ exitMessage ])
        return Deno.exit()
    }

    const exitMessage =
        Object.entries(cantContinue)
        .map(([ key, value ]) => `${key}: ${value}`)
        .join('\n')
    
    print([ exitMessage ])
    Deno.exit()
} /* implements ExitFun */

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
            HOT.Strings.Split<"{">,
            HOT.Tuples.Tail,
            HOT.Tuples.Map<HOT.Strings.Split<"}">>,
            HOT.Tuples.Map<HOT.Tuples.Head>,
            HOT.Tuples.ToUnion
        ]
    >
