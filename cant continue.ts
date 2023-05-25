export type Any =
    | CouldntFindAstroConfigFile
    | CouldntParseImageInfo
    | CouldntConnectToInternet
    | CouldntDownloadFfmpeg
    | CouldntWriteFfmpegToDisk
    | CouldntTranscodeImage

export class CouldntFindAstroConfigFile extends Error {
    constructor(
        readonly checkedPaths : string[]
    ) { super() }
}

export class CouldntParseImageInfo extends Error {
    constructor(
        readonly command : string,
        readonly output  : string,
        readonly path    : string
    ) { super() }
}

export class CouldntConnectToInternet extends Error {
    constructor(
        readonly url   : string,
        readonly error : Error
    ) { super() }
}

export class CouldntDownloadFfmpeg extends Error {
    constructor(
        readonly response : Response
    ) { super() }
}

export class CouldntWriteFfmpegToDisk extends Error {
    constructor(
        readonly error     : Error,
        readonly writingAt : string
    ) { super() }
}

export class CouldntTranscodeImage extends Error {
    constructor(
        readonly sourcePath : string,
        readonly errorLine  : string,
        readonly log        : ReadableStream<string>
    ) { super() }
}
