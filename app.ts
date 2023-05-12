
/***** IMPORTS *****/

import constants                         from './constants.ts'
import Series                            from './series.ts'
import Deferred                          from './deferred.ts'     
import * as CantContinue                 from './cant continue.ts'
import { $, fs, path, which, partition } from './deps.ts'


/***** TYPES *****/

export interface AppOptions {
    cwd   : string
    ready : (images   : fs.WalkEntry[]) => Promise<{ selectedImages : fs.WalkEntry[], transcodeOptions : TranscodeOptions }>
    show  : (progress : CantContinue.CouldntParseImageInfo | Optimization) => Promise<unknown>,
    exit  : <A extends CantContinue.Any>(cantContinue : A) => unknown
}


/***** MAIN *****/

export default async function app({ cwd, exit, show, ready }: AppOptions) {
    const maybeConfig =
        await searchForAstroConfig(cwd) ??
        await searchForAstroConfig(path.join(cwd, '..')) ??
        await searchForAstroConfig(path.join(cwd, '..', '..'))

    if (maybeConfig === undefined) return exit(
        new CantContinue.CouldntFindAstroConfigFile([
            path.join(cwd, 'astro.config.*'),
            path.join(cwd, '..', 'astro.config.*'),
            path.join(cwd, '..', '..', 'astro.config.*')
        ])
    )

    const projectDetails = parseAstroConfig(maybeConfig)
    const _ffmpeg        = createTemporaryFolder().then(searchForFfmpeg)
    const allImages      = await searchForImages(projectDetails.srcDir).toArray()
    
    const { selectedImages, transcodeOptions } = await ready(allImages)
        
    const ffmpeg = await _ffmpeg
    if (!happy(ffmpeg)) return exit(ffmpeg)

    const progressReader =
        Series.from(selectedImages)
        .map(imageFile => parseImageInfo(ffmpeg, imageFile.path))
        .safeMap(imageInfo => optimizeImage(ffmpeg, imageInfo, transcodeOptions))
        .toStream()
        .getReader()

    Array.from({ length: navigator.hardwareConcurrency }).map(run)
    
    async function run(): Promise<void> {
        const { done, value: progress } = await progressReader.read()
        if (done) return
        await show(progress)
        return run()
    }
}


/***** IMPLEMENTATION *****/

interface ConfigFile {
    path     : string
    contents : string
}

async function searchForAstroConfig(
    dir : string
) : Promise<ConfigFile | undefined> {
    const maybeFound =
        await walk(dir, { includeDirs: false, includeFiles: true, maxDepth: 1 })
            .find(file => file.name.startsWith('astro.config'))
    
    if (maybeFound === undefined) return undefined
    
    return {
        path    : maybeFound.path,
        contents: await Deno.readTextFile(maybeFound.path)
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
    path   : string
    format : string
    color  : string
    width  : number
    height : number
}

async function parseImageInfo(
    ffmpeg : string,
    path   : string
): Promise<
    | ImageInfo
    | CantContinue.CouldntParseImageInfo
> {
    // ffmpeg logs to stderr
    const commandResult        = await $`${ffmpeg} -hide_banner -i ${path}`.noThrow().stderr('piped')
    const commandOutput        = commandResult.stderr
    const imageInfoRegex       = /^\s*Stream #0:0: Video: (?<format>.+), (?<color>\w+\(.*\)), (?<width>\d+)x(?<height>\d+)/m
    const imageInfoRegexResult = commandOutput.match(imageInfoRegex)
    
    if (imageInfoRegexResult === null)
        return new CantContinue.CouldntParseImageInfo(
            `${ffmpeg} -hide_banner -i ${path}`,
            commandOutput,
            path
        )
    
    const {
        format,
        color,
        width  : _width,
        height : _height,
    } = imageInfoRegexResult.groups!
    
    const width  = Number(_width)
    const height = Number(_height)
    
    return { path, format, color, width, height } satisfies ImageInfo
}

type Optimization = CachedOptimization | UnderwayOptimization

interface CachedOptimization {
    sourcePath           : string
    previouslyTranscoded : TranscodedImage[]
}

interface UnderwayOptimization extends CachedOptimization {
    transcodingTargets : Target[]
    progress           : ReadableStream<TranscodeTask>
}

interface TranscodedImage {
    width   : number
    codec   : string
    quality : number
    path    : string
}

type TranscodeTask =
    | CantContinue.CouldntTranscodeImage
    | {
        destinationPath : string
        fullLog         : PromiseLike<string>
    }

type Target = {
    codec  : string
    format : 'jpeg' | 'webp' | 'avif' 
    path   : string
    width  : number
}

export interface TranscodeOptions {
    widths  : Array<{
        width   : number
        enabled : boolean
    }>
    formats : Array<{
        format  : 'jpeg' | 'webp' | 'avif'
        enabled : boolean
        codec   : string
        quality : number
        minimum : number
        maximum : number
    }>
}


async function optimizeImage(
    ffmpeg  : string,
    source  : ImageInfo,
    options : TranscodeOptions
) : Promise<Optimization> {
    
    const widths =
        options.widths
        // avoid upscaling by filter out widths larger than original width
        .filter(({ width, enabled }) => enabled && width < source.width)
        .map(({ width }) => width)
    
    const _targets =
        widths.flatMap(width =>
            options.formats
            .filter(({ enabled }) => enabled)
            .map(async ({ codec, format, quality }) => {
                const p = targetPathFromImageInfo(source.path, format, width, quality)
                const exists = await fs.exists(p)
                await fs.ensureDir(path.dirname(p))
                return { codec, exists, format, path: p, quality, width }
            })
        )
    
    const targets = await Promise.all(_targets)
    
    const [ previouslyTranscoded, transcodingTargets ] = partition(targets, ({ exists }) => exists)
    
    const sourcePath = source.path
    
    if (transcodingTargets.length === 0) return { sourcePath, previouslyTranscoded } satisfies CachedOptimization

    const encodeInto =
        transcodingTargets.map(({ width, codec, quality, path }) => {
            if (codec === 'libaom-av1') return `-c:v ${codec} -vf scale=${width}:-2 -b:v 0 -crf ${quality} ${path}`
            else                        return `-c:v ${codec} -vf scale=${width}:-2 -b:v 0 -q:v ${quality} ${path}`
        }).join(' ')
    
    const command = `${ffmpeg} -hide_banner -i ${sourcePath} ${encodeInto}`
    
    const progress =
        $.raw`${command}`
        .stderr('piped')
        .noThrow()
        .spawn()
        .stderr()
        .pipeThrough(new TextDecoderStream)
        .pipeThrough(progressParser(command))
    
    return { sourcePath, previouslyTranscoded, transcodingTargets, progress } satisfies UnderwayOptimization
}

function progressParser(
    command : string
) {
    let accumulatedLog  = ''
    const fullLog = new Deferred<string>
    return new TransformStream<string, TranscodeTask>({
        transform(chunk, controller) {
            if (/Error|error|Conversion failed|Could not open file|Invalid argument|Unable to find a suitable output format/.test(chunk))
                controller.enqueue(
                    new CantContinue.CouldntTranscodeImage(command, chunk, fullLog)
                )
            const match = chunk.match(/Output #\d+, [^\s]+, to '(?<path>[^']*.)':/)
            if (match !== null) controller.enqueue({ destinationPath: match.groups!.path, fullLog })
            accumulatedLog += chunk
        },
        flush() {
            fullLog.resolve(accumulatedLog)
        }
    })
}

function targetPathFromImageInfo(
    sourcePath : string,
    format     : string,
    width      : number,
    quality    : number,
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
        .filter(file => file.path.includes(path.sep + constants.optimizedFolderName + path.sep) === false)
}

async function createTemporaryFolder() {
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

    else localStorage.removeItem('ffmpegPath')
    
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
    const cache          = await caches.open('astro-optimize-images')
    const url            = constants.ffmpeg.downloadUrl.windows.x64
    const ffmpegRequest  = new Request(url)
    const alreadyFetched = await cache.match(ffmpegRequest)
    
    const ffmpegResponse = alreadyFetched ?? await fetch(ffmpegRequest).catch(error => error as Error)

    if (ffmpegResponse instanceof Error)
        return new CantContinue.CouldntConnectToInternet(url, ffmpegResponse)

    if (ffmpegResponse.ok === false)
        return new CantContinue.CouldntDownloadFfmpeg(ffmpegResponse)

    if (alreadyFetched === undefined) {
        cache.put(ffmpegRequest, ffmpegResponse.clone()).catch(_ => _)
    }
    
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


/***** UTILITY FUNCTIONS *****/

type WalkParams = Parameters<typeof fs.walk>

function walk(root: WalkParams[0], options?: WalkParams[1]) {
    return Series.from(fs.walk(root, options))
}

function happy<A>(a : A) : a is Exclude<A, Error> {
    return unhappy(a) === false
}

function unhappy<A>(a : A) : a is Extract<A, Error> {
    return a instanceof Error
}
