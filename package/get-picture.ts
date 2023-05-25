interface Props {
    src      : string
    formats ?: Array<string>
    widths  ?: Array<number>
}

export default function getPicture(
    manifest : Record<string, unknown>,
    { src, formats, widths } : Props
) {

    if (typeof src !== 'string')
        throw new TypeError('The "src" attribute must be passed to Image and must be of the type "string".\nReceived: ' + src + '\n Type: ' + typeof src + '.')

    if (src in manifest === false)
        throw new TypeError(src + ' does not refer to an optimized image. If you recently added this image, rerun astro-optimize-images.')

    const manifestFormats = manifest[src] as Record<string, unknown>

    const pickedFormats =
        Object.keys(manifestFormats)
        .filter(f => formats === undefined || formats.includes(f))
    
    if (pickedFormats.length === 0) {
        if (formats?.length === 0)
            throw new TypeError('No formats were passed to Image. Please pass at least one format to Image.')
        else
            throw new TypeError(src + ' has not been optimized to any format. This may be because the optimization for this image failed, and you need to rerun astro-optimize-images.')
    }

    const sources =
        pickedFormats
        .map(format => {
            const manifestWidths = manifestFormats[format] as Record<number, unknown>
            
            const srcset =
                Object.keys(manifestWidths)
                .filter(w => widths === undefined || widths.includes(Number(w)))
                .map(width => `${getLink(manifestWidths[width as any])} ${width}w`)
                .join(', ')
            
            return {
                type: getType(format),
                srcset
            }
        })
    
    return sources
}

function getLink(image : unknown) : string {

    if (typeof image === 'string')
        return image

    if (
        typeof image === 'object' &&
        image !== null &&
        'src' in image &&
        typeof image.src === 'string'
    ) return image.src

    throw new Error('Unexpected Error: image information is not usable. Expected imported image to either be a string or an object with a "src" property. Received:\n' + JSON.stringify(image, null, 4))
}

function getType(format : string) : string {
    
    if (format === 'jpeg') return 'image/jpeg'
    if (format === 'webp') return 'image/webp'
    if (format === 'avif') return 'image/avif'

    throw new Error('Unexpected Error: ' + format + ' is not a valid format. This is a bug in astro-optimize-images. Please report this message, and consider using something else in the meanwhile.')
}