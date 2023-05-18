
/***** IMPORTS *****/

import constants                         from './constants.ts'
import Series                            from './series.ts'
import * as CantContinue                 from './cant continue.ts'
import { $, fs, path, which, partition } from './deps.ts'
import { print } from './terminal.ts'


/***** TYPES *****/

export interface AppOptions {
    cwd          : string
    ready        : (images   : string[], transcodeOptions : TranscodeOptions) => Promise<{ selectedImages : string[], widths : Array<number>, formats: Array<FormatDetails> }>
    reportError  : <A extends CantContinue.Any>(cantContinue : A) => unknown
    showProgress : (sourcePath : string, progress : ReadableStream<TranscodingProgress>) => Promise<unknown>
    showSummary  : (imageInfo : ImageInfo, transcodeTasks : TranscodeTask[]) => unknown
}

export interface TranscodeOptions {
    formats : Record<Format, {
        enabled : boolean
        codec   : string
        quality : number
        minimum : number
        maximum : number
    }>
    widths : Array<{
        width   : number
        enabled : boolean
    }>
}


/***** MAIN *****/

export default async function app({ cwd, ready, reportError, showProgress, showSummary }: AppOptions) {

    /*** SETUP ***/

    const configFile = await searchForAstroConfig(cwd)

    if (unhappy(configFile)) return reportError(configFile)

    const projectDetails = parseAstroConfig(configFile)
    const ffmpegPromise  = findOrCreateTemporaryFolder().then(searchForFfmpeg)
    const allImages      = await searchForImages(projectDetails.srcDir).toArray()
    
    const { selectedImages, widths, formats } =
        await ready(allImages, structuredClone(constants.transcoding))
    
    const ffmpeg = await ffmpegPromise

    if (unhappy(ffmpeg)) return reportError(ffmpeg)


    /*** OPTIMIZATION ***/

    const jobQueue = selectedImages[Symbol.iterator]()
    const accumulatedOptimizations = new Array<{ imageInfo: ImageInfo, tasks: TranscodeTask[] }>

    // thread pool
    // TODO: investigate whether the codecs used are multi-threaded
    // they may need to be made single-threaded for this to be optimal
    await Promise.all(Array.from({ length: navigator.hardwareConcurrency }).map(
        async function spawnThread() : Promise<void> {
            const { done, value: sourcePath } = jobQueue.next()
            
            // close this thread
            if (done) return

            const imageInfo = await parseImageInfo(ffmpeg, sourcePath)
            
            if (unhappy(imageInfo)) {
                await reportError(imageInfo)
                // process another image on this thread
                return spawnThread()
            }

            const transcodeMatrix = createTranscodeMatrix(imageInfo, widths, formats)
            const { previouslyTranscoded, requiredTranscodes } = await determineRequiredTranscodes(transcodeMatrix)
            const justTranscoded = new Array<TranscodeTask>

            if (requiredTranscodes.length > 0) {
                const { progress, couldntTranscodeImage } = optimizeImage(ffmpeg, imageInfo.sourcePath, requiredTranscodes)
                
                await showProgress(sourcePath, progress)
                const cantContinue = await couldntTranscodeImage
                if (cantContinue !== null) reportError(cantContinue)
    
                const transcoded : TranscodeTask[] =
                    await Promise.all(
                        requiredTranscodes.map(async task => {
                            const stat = await safeStat(task.destinationPath)
                            await fs.ensureDir(path.dirname(task.destinationPath))
                            if (stat === null) return { ...task, new: true }
                            return { ...task, stat, new: true }
                        })
                    )

                justTranscoded.concat(transcoded)
            }

            // this line is to make the type of previouslyTranscoded less specific
            // so that concat doesnt complain about incompatible types on the next
            const prevTasks : TranscodeTask[] = previouslyTranscoded

            const tasks = prevTasks.concat(justTranscoded)

            accumulatedOptimizations.push({ imageInfo, tasks })

            // create and show a summary of the optimization
            // formats, widths, file sizes and savings on a table
            await showSummary(imageInfo, tasks)
            
            // process another image on this thread
            return spawnThread()
        }
    ))


    /*** CREATING THE MANIFEST FILE ***/
    
    const tick = createTicker()
    
    type SourcePath = string
    type Width      = number
    type Identifier = `$${number}`

    const manifest : Record<SourcePath, { original : Identifier } & Record<Format, Record<Width, Identifier>>> = {}
    let manifestFileContents = ''

    accumulatedOptimizations.forEach(({ imageInfo, tasks }) => {
        
        const sourceIndentifier: Identifier = `$${ tick() }`
        
        const sourcePath : SourcePath =
            Deno.build.os === 'windows'
                ? path.relative(configFile.path, imageInfo.sourcePath).replaceAll('\\', '/')
                : path.relative(configFile.path, imageInfo.sourcePath)
        
        // TODO: make this a relative path
        manifestFileContents += `import ${sourceIndentifier} from '${sourcePath}'\n`
        tasks.forEach(task => {
            const format     : Format     = task.format
            const width      : Width      = task.width
            const identifier : Identifier = `$${ tick() }`
            
            const destinationPath = 
                Deno.build.os === 'windows'
                    ? path.relative(configFile.path, task.destinationPath).replaceAll('\\', '/')
                    : path.relative(configFile.path, task.destinationPath)

            manifest[sourcePath]              ??= { original : sourceIndentifier } as { original : Identifier} & Record<Format, Record<Width, Identifier>>
            manifest[sourcePath][format]      ??= {}
            manifest[sourcePath][format][width] = identifier
            
            // TODO: make this a relative path
            manifestFileContents += `import ${identifier} from '${destinationPath}'\n`
        })
    })
    manifestFileContents += '\nexport default '
    manifestFileContents += JSON.stringify(manifest, null, 4).replaceAll(/"\$(\d+)"/g, match => match.slice(1, -1))
    manifestFileContents += ' as const'
    print([manifestFileContents])
}


/***** IMPLEMENTATION *****/

interface ConfigFile {
    path     : string
    contents : string
}

async function searchForAstroConfig(
    dir : string
) {
    const fileNames = [
        'astro.config.mjs',
        'astro.config.mts',
        'astro.config.js',
        'astro.config.ts',
        'astro.config.cjs',
        'astro.config.cts',
    ]

    const dirs = [
        dir,
        path.join(dir, '..'),
        path.join(dir, '..', '..')
    ]

    const paths = dirs.flatMap(dir => fileNames.map(fileName => path.join(dir, fileName)))

    // project may be inside the root folder (/project)
    // in which case /project/.. and /project/../.. are the same 
    const uniquePaths = Array.from(new Set(paths))

    const configFilePath =
        await Series.from(uniquePaths)
        .find(async path => await safeStat(path) !== null)
    
    if (configFilePath === undefined)
        return new CantContinue.CouldntFindAstroConfigFile(uniquePaths)
    
    return {
        path    : configFilePath,
        contents: await Deno.readTextFile(configFilePath)
    } satisfies ConfigFile
}

interface ProjectDetails {
    srcDir    : string
    outDir    : string
    publicDir : string
}

function parseAstroConfig(
    config : ConfigFile
) : ProjectDetails {
    const configRegex = /(srcDir(\s*):(\s*)["'`](?<srcDir>.*)["'`])|(outDir(\s*):(\s*)["'`](?<outDir>.*)["'`])|(publicDir(\s*):(\s*)["'`](?<publicDir>.*)["'`])/
    
    const {
        srcDir   : relativeSrcDir    = './src',
        outDir   : relativeOutDir    = './dist',
        publicDir: relativePublicDir = './public'
    } = config.contents.match(configRegex)?.groups ?? {}
    
    const srcDir    = path.join(path.dirname(config.path), relativeSrcDir)
    const outDir    = path.join(path.dirname(config.path), relativeOutDir)
    const publicDir = path.join(path.dirname(config.path), relativePublicDir)
    
    return { srcDir, outDir, publicDir } satisfies ProjectDetails
}

interface ImageInfo {
    color      : string
    format     : string
    sourcePath : string
    stat       : Deno.FileInfo
    height     : number
    width      : number
}

async function parseImageInfo(
    ffmpeg     : string,
    sourcePath : string
): Promise<
    | ImageInfo
    | CantContinue.CouldntParseImageInfo
> {
    // ffmpeg logs to stderr
    const commandResult        = await $`${ffmpeg} -hide_banner -i ${sourcePath}`.noThrow().stderr('piped')
    const commandOutput        = commandResult.stderr
    const imageInfoRegex       = /^\s*Stream #0:0: Video: (?<format>.+), (?<color>\w+\(.*\)), (?<width>\d+)x(?<height>\d+)/m
    const imageInfoRegexResult = commandOutput.match(imageInfoRegex)
    const stat                 = await Deno.stat(sourcePath)
    
    if (imageInfoRegexResult === null)
        return new CantContinue.CouldntParseImageInfo(
            `${ffmpeg} -hide_banner -i ${sourcePath}`,
            commandOutput,
            sourcePath
        )
    
    const {
        format,
        color,
        width  : _width,
        height : _height,
    } = imageInfoRegexResult.groups!
    
    const width  = Number(_width)
    const height = Number(_height)
    
    return { color, format, sourcePath, height, width, stat } satisfies ImageInfo
}

type Format = 'jpeg' | 'webp' | 'avif'

interface FormatDetails {
    codec   : string
    format  : Format
    quality : number
}

interface TranscodeTask extends FormatDetails {
    destinationPath : string
    new            ?: true
    stat           ?: Deno.FileInfo
    width           : number
}

interface SuccessfulTranscodeTask extends TranscodeTask {
    stat : Deno.FileInfo
}

type TranscodeMatrix = Array<TranscodeTask>

function createTranscodeMatrix(
    image   : ImageInfo,
    widths  : number[],
    formats : Array<{
        codec   : string
        format  : Format
        quality : number
    }>
) : TranscodeMatrix {
    return (
        formats.flatMap(({ format, codec, quality }) =>
            widths
            // avoid upscales
            .filter(width => width < image.width)
            .map(width => {
                const destinationPath = determineDestinationPath(image.sourcePath, format, quality, width)
                return { codec, format, destinationPath, quality, width }
            })
        )
    )
}

async function determineRequiredTranscodes(
    transcodeMatrix : TranscodeMatrix
) {
    const stattedTranscodeMatrix : Array<SuccessfulTranscodeTask | TranscodeTask> =
        await Promise.all(
            transcodeMatrix.map(async task => {
                const stat = await safeStat(task.destinationPath)
                await fs.ensureDir(path.dirname(task.destinationPath))
                if (stat === null) return task
                return { ...task, stat }
            })
        )
    
    const [ previouslyTranscoded, requiredTranscodes ] =
        partition(
            stattedTranscodeMatrix,
            (task) : task is SuccessfulTranscodeTask => 'stat' in task
        )

    return { previouslyTranscoded, requiredTranscodes }
}

type TranscodingProgress = { destinationPath : string }

function optimizeImage(
    ffmpeg         : string,
    sourcePath     : string,
    transcodeTasks : Array<TranscodeTask>,
) {
    const encodeInto =
        transcodeTasks.map(({ width, codec, quality, destinationPath }) => {
            if (codec === 'libaom-av1') return `-c:v ${codec} -vf scale=${width}:-2 -b:v 0 -crf ${quality} ${destinationPath}`
            else                        return `-c:v ${codec} -vf scale=${width}:-2 -b:v 0 -q:v ${quality} ${destinationPath}`
        }).join(' ')
    
    const command = `${ffmpeg} -hide_banner -i ${sourcePath} ${encodeInto}`

    let accumulatedLog  = ''
    const fullLog = new Future<string>
    const couldntTranscodeImage = new Future<CantContinue.CouldntTranscodeImage | null>

    const { readable: progress, writable: progressWritable } =
        new TransformStream<TranscodingProgress, TranscodingProgress>
    
    const progressWriter = progressWritable.getWriter()

    $.raw`${command}`
    .stderr('piped')
    .noThrow()
    .spawn()
    .stderr()
    .pipeThrough(new TextDecoderStream)
    .pipeTo(new WritableStream({
        
        write(chunk) {
            const errorMatch = chunk.match(/Error|error|Conversion failed|Could not open file|Invalid argument|Unable to find a suitable output format|At least one output file must be specified/)
            
            if (errorMatch !== null) {
                const e = new CantContinue.CouldntTranscodeImage(command, sourcePath, chunk, fullLog)
                couldntTranscodeImage.resolve(new CantContinue.CouldntTranscodeImage(command, sourcePath, chunk, fullLog))
            }
            
            const progressMatch = chunk.match(/Output #\d+, [^\s]+, to '(?<path>[^']*.)':/)
            
            if (progressMatch !== null)
                progressWriter.write({ destinationPath: progressMatch.groups!.path })

            accumulatedLog += chunk
        },

        close() {
            progressWriter.close()
            progressWriter.releaseLock()
            fullLog.resolve(accumulatedLog)
            couldntTranscodeImage.resolve(null)
        }
    }))
    
    return { progress, couldntTranscodeImage }
}

function determineDestinationPath(
    sourcePath : string,
    format     : string,
    quality    : number,
    width      : number
) {
    const fileName = `${path.basename(sourcePath, path.extname(sourcePath))}-${quality}q-${width}w.${format}`

    return path.join(
        path.dirname(sourcePath),
        constants.optimizedFolderName,
        fileName
    )
}

function searchForImages(
    inFolder   : string
) {
    return walk(inFolder)
        .filter(file => constants.considerForOptimization.some(ext => file.name.endsWith(ext)))
        .map(({ path }) => path)
        .filter(sourcePath => sourcePath.includes(path.sep + constants.optimizedFolderName + path.sep) === false)
}

async function findOrCreateTemporaryFolder() {
    const previouslyCreatedAt = localStorage.getItem('temporary folder')

    if (
        previouslyCreatedAt !== null &&
        await fs.exists(previouslyCreatedAt, { isDirectory: true })
    ) return previouslyCreatedAt

    const newTemporaryFolder = await Deno.makeTempDir({ prefix: constants.projectName })
    
    const previouslyUsed =
        await walk(
            path.join(newTemporaryFolder, '..'),
            { maxDepth: 1, includeFiles: false, includeDirs: true }
        ).find(dir => dir.name.startsWith(constants.projectName) && dir.path !== newTemporaryFolder)
    
    if (previouslyUsed === undefined) {
        localStorage.setItem('temporary folder', newTemporaryFolder)
        return newTemporaryFolder
    }

    else {
        localStorage.setItem('temporary folder', previouslyUsed.path)
        Deno.remove(newTemporaryFolder).catch(_ => _)
        return previouslyUsed.path
    }
}

async function searchForFfmpeg(
    temporaryFolder : string
) {
    const previouslyFoundAt = localStorage.getItem('ffmpeg path')
    
    if (
        previouslyFoundAt !== null &&
        await fs.exists(previouslyFoundAt, { isFile: true })
    ) return previouslyFoundAt

    else localStorage.removeItem('ffmpeg path')
    
    const suffix = Deno.build.os === 'windows' ? '.exe' : ''
    const tempFfmpegPath = `${temporaryFolder}/ffmpeg${suffix}'}`
    const ffmpegPath = await which('ffmpeg') ?? await downloadFfmpeg(tempFfmpegPath)
    if (happy(ffmpegPath)) localStorage.setItem('ffmpeg path', ffmpegPath)
    
    return ffmpegPath
}

async function downloadFfmpeg(
    ffmpegPath: string
): Promise<
    | string
    | CantContinue.CouldntConnectToInternet
    | CantContinue.CouldntDownloadFfmpeg
    | CantContinue.CouldntWriteFfmpegToDisk
> {
    const url            = constants.ffmpeg.downloadUrl.windows.x64
    const ffmpegResponse = await fetch(url).catch(error => error as Error)

    if (unhappy(ffmpegResponse))
        return new CantContinue.CouldntConnectToInternet(url, ffmpegResponse)

    if (ffmpegResponse.ok === false)
        return new CantContinue.CouldntDownloadFfmpeg(ffmpegResponse)
    
    try {
        const ffmpegFileHandler = await Deno.open(ffmpegPath, { create: true, write: true })
        await ffmpegResponse.body!.pipeTo(ffmpegFileHandler.writable)
        ffmpegFileHandler.close()
        return ffmpegPath
    }
    catch (error) {
        return new CantContinue.CouldntWriteFfmpegToDisk(ffmpegPath, error)
    }
}

/***** FUTURE *****/

class Future<A = unknown> implements PromiseLike<A> {

    [Symbol.toStringTag] = 'Future'
    
    then    : Promise<A>['then']
    catch   : Promise<A>['catch']
    finally : Promise<A>['finally']
    
    resolve !: (value: A | PromiseLike<A>) => void
    reject  !: (reason?: unknown) => void
    
    constructor() {
        const promise = new Promise<A>((resolve, reject) => {
            this.resolve = resolve
            this.reject  = reject
        })
        this.then    = (...args) => promise.then   (...args)
        this.catch   = (...args) => promise.catch  (...args)
        this.finally = (...args) => promise.finally(...args)
    }
}


/***** UTILITY FUNCTIONS *****/

type WalkParams = Parameters<typeof fs.walk>

function walk(root: WalkParams[0], options?: WalkParams[1]) {
    return Series.from(fs.walk(root, options))
}

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

function createTicker() {
    let x = 0
    return () => ++x
}

function happy<A>(a : A) : a is Exclude<A, Error> {
    return unhappy(a) === false
}

function unhappy<A>(a : A) : a is Extract<A, Error> {
    return a instanceof Error
}

/***** UTILITY TYPES *****/

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
