export default function getResolution(
    manifest : Record<string, unknown>,
    src : string
) : { height : number, width : number } {
    
    if (typeof src !== 'string')
        throw new TypeError('The "src" attribute must be passed to Image and must be of the type "string".\nReceived: ' + src + '\n Type: ' + typeof src + '.')
    
    if (src in manifest === false)
        throw new TypeError(src + ' does not refer to an optimized image. If you recently added this image, rerun astro-optimize-images.')
    
    const metadata = (manifest[src] as { meta : Record<string, unknown> }).meta
    
    const { height, width } = metadata
    
    if (typeof height !== 'number' || typeof width !== 'number')
        throw new TypeError('The metadata for ' + src + ' is invalid. This is a bug in astro-optimize-images. Please report this message. Complete metadata:\n' + JSON.stringify(metadata, null, 4))
    
    return { height, width }
}