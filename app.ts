
/***** IMPORTS *****/

import constants                         from './constants.ts'
import Series                            from './series.ts'
import * as CantContinue                 from './cant continue.ts'
import { $, fs, path, which, partition } from './deps.ts'


/***** TYPES *****/

export interface AppOptions {
    cwd          : string
    ready        : (images : string[], transcodeOptions : TranscodeOptions)              => Promise<OptimizationManifest>
    reportError  : (cantContinue : CantContinue.Any)                                     => unknown
    showProgress : (sourcePath : string, progress : ReadableStream<TranscodingProgress>) => Promise<unknown>
    showSummary  : (imageInfo : ImageInfo, transcodeTasks : TranscodeTask[])             => unknown
}

export interface OptimizationManifest {
    selectedImages : string[]
    widths         : Array<number>
    formats        : Array<FormatDetails>
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

    const configFile = await searchForAstroConfig(cwd)

    if (unhappy(configFile)) return reportError(configFile)

    const projectDetails = parseAstroConfig(configFile)
    const manifestPath   = path.join(projectDetails.pkgPath, 'manifest.ts')
    const ffmpegPromise  = findOrCreateTemporaryFolder().then(searchForFfmpeg)
    const allImages      = await searchForImages(projectDetails.srcDir).toArray()
    
    const { selectedImages, widths, formats } =
        await ready(allImages, structuredClone(constants.transcoding))
    
    const ffmpeg = await ffmpegPromise

    if (unhappy(ffmpeg)) return reportError(ffmpeg)

    // TODO: investigate whether the codecs used are multi-threaded
    // they may need to be made single-threaded for this to be optimal
    // TODO: consider available memory in addition to available cores
    const opts =
        await concurrentMap(
            Math.max(1, Math.ceil(navigator.hardwareConcurrency / 2)),
            selectedImages,
            sourcePath => processImage(ffmpeg, projectDetails, sourcePath, widths, formats, reportError, showProgress, showSummary)
        )

    const optimizations = opts.filter(happy)
    
    await writeManifestFile(projectDetails, optimizations, manifestPath)
    await Deno.copyFile(import.meta.resolve('./package/getImage.ts') , path.join(projectDetails.pkgPath, 'getImage.ts'))
    await Deno.copyFile(import.meta.resolve('./package/Image.astro') , path.join(projectDetails.pkgPath, 'Image.astro'))
    await Deno.copyFile(import.meta.resolve('./package/pacakge.json'), path.join(projectDetails.pkgPath, 'pacakge.json'))
    await Deno.copyFile(import.meta.resolve('./package/index.ts')    , path.join(projectDetails.pkgPath, 'index.ts'))

    // TODO happy exit message
}


/***** PROCEDURES *****/

async function processImage(
    ffmpeg         : string,
    projectDetails : ProjectDetails,
    sourcePath     : string,
    widths         : number[],
    formats        : Array<FormatDetails>,
    reportError    : AppOptions['reportError'],
    showProgress   : AppOptions['showProgress'],
    showSummary    : AppOptions['showSummary']
) {
    
    const imageInfo = await parseImageInfo(ffmpeg, sourcePath)
    
    if (unhappy(imageInfo)) {
        await reportError(imageInfo)
        // process another image on this thread
        return imageInfo
    }

    const transcodeMatrix =
        createTranscodeMatrix(projectDetails, imageInfo, widths, formats)
    
    const { previouslyTranscoded, requiredTranscodes } =
        await determineRequiredTranscodes(transcodeMatrix)
    
    if (requiredTranscodes.length === 0) {
        // create and show a summary of the optimization
        // formats, widths, file sizes and savings on a table
        await showSummary(imageInfo, previouslyTranscoded)
        return { imageInfo, tasks: previouslyTranscoded }
    }

    const { progress, couldntTranscodeImage } =
        optimizeImage(ffmpeg, imageInfo.sourcePath, requiredTranscodes)
    
    await showProgress(sourcePath, progress)
    
    // for type safety of the unhappy path,
    // this promise is fulfilled with an error,
    // and rejected with "ok".
    await couldntTranscodeImage.then(reportError).catch((happy: "ok") => happy)

    const justTranscoded : TranscodeTask[] =
        await Promise.all(
            requiredTranscodes.map(async task => {
                const stat = await safeStat(task.destinationPath)
                await fs.ensureDir(path.dirname(task.destinationPath))
                if (stat === null) return { ...task, new: true }
                if (stat.size === 0) {
                    await Deno.remove(task.destinationPath)
                    return { ...task, new: true }
                }
                return { ...task, stat, new: true }
            })
        )
    
    // this line is to make the type of previouslyTranscoded less specific
    // so that concat doesnt complain about incompatible types on the next
    const prevTasks : TranscodeTask[] = previouslyTranscoded
    const allTasks = prevTasks.concat(justTranscoded)
    const tasks    = allTasks.filter(task => 'stat' in task)
    
    await showSummary(imageInfo, allTasks)

    return { imageInfo, tasks }
}

async function writeManifestFile(
    projectDetails   : ProjectDetails,
    optimizations    : Array<{ imageInfo : ImageInfo, tasks : TranscodeTask[] }>,
    manifestFilePath : string
) {

    const tick = createTicker()
    
    type Width      = number
    type Identifier = `$${number}`

    const manifest : Record<string, { original : Identifier } & Record<Format, Record<Width, Identifier>>> = {}

    const importStatements = optimizations.flatMap(({ imageInfo, tasks }) => {
        
        const sourceIndentifier: Identifier = `$${ tick() }`
        
        const sourceSpecifier =
            Deno.build.os === 'windows'
                ? '../' + path.relative(projectDetails.rootDir, imageInfo.sourcePath).replaceAll('\\', '/')
                : '../' + path.relative(projectDetails.rootDir, imageInfo.sourcePath)

        const imageSrc =
            Deno.build.os === 'windows'
                ? path.relative(projectDetails.srcDir, imageInfo.sourcePath).replaceAll('\\', '/')
                : path.relative(projectDetails.srcDir, imageInfo.sourcePath)
        
        manifest[imageSrc] ??= { original : sourceIndentifier } as { original : Identifier } & Record<Format, Record<Width, Identifier>>
        
        const importStatementsForOptimizedImages = tasks.map(task => {

            const format     : Format     = task.format
            const width      : Width      = task.width
            const identifier : Identifier = `$${ tick() }`
            
            const destinationSpecifier = 
                Deno.build.os === 'windows'
                    ? './' + path.relative(path.dirname(manifestFilePath), task.destinationPath).replaceAll('\\', '/')
                    : './' + path.relative(path.dirname(manifestFilePath), task.destinationPath)

            manifest[imageSrc][format]      ??= {}
            manifest[imageSrc][format][width] = identifier
            
            return `import ${identifier} from '${destinationSpecifier}'`
        })

        return [
            `import ${sourceIndentifier} from '${sourceSpecifier}'`,
            ...importStatementsForOptimizedImages
        ]
    })

    const manifestFileContents =
        importStatements.join('\n') +
        '\n' +
        'export default ' +
        JSON.stringify(manifest, null, 4)
            // remove quotation marks from identifiers, "$1" -> $1
            .replaceAll(/"\$(\d+)"/g, match => match.slice(1, -1))
            // remove quotation marks from widths, "100": -> [100]:
            .replaceAll(/"(\d+)":/g, match => `[${match.slice(1, -2)}]:`) +
        ' as const'

    await Deno.writeTextFile(manifestFilePath, manifestFileContents)
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
    rootDir   : string
    srcDir    : string
    outDir    : string
    publicDir : string
    pkgPath   : string
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
    
    const rootDir   = path.dirname(config.path)
    const srcDir    = path.join(path.dirname(config.path), relativeSrcDir)
    const outDir    = path.join(path.dirname(config.path), relativeOutDir)
    const publicDir = path.join(path.dirname(config.path), relativePublicDir)
    const pkgPath   = path.join(rootDir, 'node_modules', constants.packageName)
    
    return { rootDir, srcDir, outDir, publicDir, pkgPath } satisfies ProjectDetails
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
    projectDetails : ProjectDetails,
    image          : ImageInfo,
    widths         : number[],
    formats        : Array<FormatDetails>
) : TranscodeMatrix {
    return (
        formats.flatMap(({ format, codec, quality }) =>
            widths
            // avoid upscales
            .filter(width => width < image.width)
            .concat([ image.width ])
            .map(width => {
                const destinationPath = determineDestinationPath(projectDetails, image.sourcePath, quality, width, format)
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
                // ffmpeg creates empty files when it fails
                if (stat.size === 0) {
                    await Deno.remove(task.destinationPath)
                    return task
                }
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
        transcodeTasks.map(({ width, codec, format, quality, destinationPath }) => {
            if (format === 'jpeg') return `-c:v ${codec} -f mjpeg -vf scale=${width}:-2 -q:v ${quality} ${destinationPath}`
            if (format === 'webp') return `-c:v ${codec} -f webp  -vf scale=${width}:-2 -q:v ${quality} ${destinationPath}`
            if (format === 'avif') return `-c:v ${codec} -f avif  -vf scale=${width}:-2 -qp  ${quality} ${destinationPath}`
        }).join(' ')
    
    const log             = new TransformStream<string, string>
    const progress        = new TransformStream<TranscodingProgress, TranscodingProgress>
    const logWriter       = log.writable.getWriter()
    const progressWriter  = progress.writable.getWriter()
    const transcodedError = new Resolvable<CantContinue.CouldntTranscodeImage>
    const command         = `${ffmpeg} -hide_banner -i ${sourcePath} ${encodeInto}`
    
    $.raw`${command}`
    .stderr('piped')
    .noThrow()
    .spawn()
    .stderr()
    .pipeThrough(new TextDecoderStream)
    .pipeTo(new WritableStream({

        start() {
            logWriter.write('> ' + command + '\n\n')
        },
        
        write(chunk) {
            const errorMatch = chunk.match(/Error|error|Conversion failed|Could not open file|Invalid argument|Unable to find a suitable output format|At least one output file must be specified|Unknown encoder/)
            
            if (errorMatch !== null)
                transcodedError.fulfill(new CantContinue.CouldntTranscodeImage(sourcePath, chunk, log.readable))
            
            const progressMatch = chunk.match(/Output #\d+, [^\s]+, to '(?<path>[^']*.)':/)
            
            if (progressMatch !== null)
                progressWriter.write({ destinationPath: progressMatch.groups!.path })

            logWriter.write(chunk)
        },

        close() {
            progressWriter.close()
            logWriter.close()
            // this will have no effect if it's already been fulfilled with an error
            transcodedError.reject("ok")
        }
    }))
    
    return {
        progress             : progress.readable,
        couldntTranscodeImage: transcodedError.promise
    }
}

function determineDestinationPath(
    projectDetails : ProjectDetails,
    sourcePath     : string,
    quality        : number,
    width          : number,
    format         : string
) {
    const relative = path.relative(projectDetails.rootDir, path.dirname(sourcePath))
    const fileName = `${path.basename(sourcePath, path.extname(sourcePath))}-${quality}q-${width}w.${format}`

    return path.join(
        projectDetails.pkgPath,
        constants.optimizedFolderName,
        relative,
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

    const newTemporaryFolder = await Deno.makeTempDir({ prefix: constants.packageName })
    
    const previouslyUsed =
        await walk(
            path.join(newTemporaryFolder, '..'),
            { maxDepth: 1, includeFiles: false, includeDirs: true }
        ).find(dir => dir.name.startsWith(constants.packageName) && dir.path !== newTemporaryFolder)
    
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
    const tempFfmpegPath = `${temporaryFolder}/ffmpeg${suffix}`
    
    const ffmpegPath =
        await checkFfmpegEnvironmentVariable() ??
        await which('ffmpeg') ??
        await downloadFfmpeg(tempFfmpegPath)
    
    if (happy(ffmpegPath)) localStorage.setItem('ffmpeg path', ffmpegPath)
    
    return ffmpegPath
}

async function checkFfmpegEnvironmentVariable() {
    const ffmpegPath = Deno.env.get(constants.ffmpeg.env)
    if (
        ffmpegPath !== undefined &&
        await fs.exists(ffmpegPath, { isFile: true })
    ) return ffmpegPath
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
        return new CantContinue.CouldntWriteFfmpegToDisk(error, ffmpegPath)
    }
}


/***** UTILITY FUNCTIONS *****/

async function concurrentMap<A, B>(
    concurrency : number,
    iterable    : Iterable<A> | AsyncIterable<A>,
    callback    : (a : A) => Promise<B> | B
) : Promise<Array<B>> {
    
    const result = new Array<B>

    const iterator =
        Symbol.iterator in iterable
            ? iterable[Symbol.iterator]()
            : iterable[Symbol.asyncIterator]()

    async function spawnThread() : Promise<void> {
        const { value, done } = await iterator.next()
        
        // close this thread
        if (done) return
        
        // does not preserve order
        result.push(await callback(value))
        
        // process another element on this thread
        return spawnThread()
    }

    // kick off
    await Promise.all(
        // thread pool
        Array.from({ length: concurrency }).map(spawnThread)
    )

    return result
}

function walk(root: string | URL, options?: fs.WalkOptions) {
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

class Resolvable<A = unknown> {
    promise  : Promise<A>
    fulfill !: (value : A | PromiseLike<A>) => void
    reject  !: (reason ?: unknown) => void

    constructor() {
        this.promise = new Promise<A>((res, rej) => {
            this.fulfill = res
            this.reject  = rej
        })
    }
}

function createTicker() {
    let x = 1
    return () => x++
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
