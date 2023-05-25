export function getImage(
    manifest : Record<string, unknown>,
    { src, format, width } : Record<string, unknown>
) : string {
    
    if (typeof src !== 'string')
        throw new TypeError('The "src" attribute must be passed to Image and must be of the type "string".\nReceived: ' + src + '\n Type: ' + typeof src + '.')
    
    if (src in manifest === false)
        throw new TypeError(src + ' does not refer to an optimized image. If you recently added this image, rerun astro-optimize-images.')
    
    const formats = manifest[src] as Record<string, unknown>

    // Automatically pick a format if one is not explicitly requested, preferring jpeg.
    const widths =
        (typeof format === 'string'
            ? formats[format]
            : formats['jpeg'] ?? formats['webp'] ?? formats['avif']) as Record<string, unknown>

    if (widths === undefined)
        throw new TypeError(src + ' has not been optimized to ' + format ?? 'any format' + '. This may be because the optimization for this image failed, or the format wasn\'t enabled. You may need to rerun astro-optimize-images.')

    const largestWidth = Object.keys(widths).map(Number).sort((a, b) => b - a).at(0)!

    if (Number.isFinite(largestWidth) === false)
        throw new Error('Unexpected Error: ' + largestWidth + 'is not a valid width for ' + src + '. This is a bug in astro-optimize-images. Please report this message, and consider using something else in the meanwhile.')

    // Automatically pick the largest width if one is not explicitly requested.
    const image =
        typeof width === 'number'
            ? widths[width]
            : widths[largestWidth]

    if (image === undefined)
        throw new TypeError(src + ' has not been optimized for the width of ' + width + '. Consider using one of the available widths: ' + Object.keys(widths).join(', ') + '.')

    if (typeof image === 'string')
        return image

    if (
        typeof image === 'object' &&
        image !== null &&
        'src' in image &&
        typeof image.src === 'string'
    ) return image.src

    throw new Error('Unexpected Error: image information is not usable. Expected imported image to either be a string or an object with a "src" property. Received:\n' + JSON.stringify(src, null, 4))
}