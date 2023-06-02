export default {
    packageName        : 'astro-optimize-images',
    optimizedFolderName: '_optimized_images',
    ffmpeg: {
        env: 'FFMPEG_PATH',
        downloadLink: {
            linux: {
                x86_64: 'https://github.com/lilnasy/ffmpeg-actions/releases/download/ffmpeg-2023-05-30-19-42/ffmpeg-linux-x86_64',
            },
            windows: {
                x86_64: 'https://github.com/lilnasy/ffmpeg-actions/releases/download/ffmpeg-2023-05-30-19-42/ffmpeg-windows-x86_64.exe'
            },
            darwin: {
                x86_64: 'https://github.com/lilnasy/ffmpeg-actions/releases/download/ffmpeg-2023-05-30-19-42/ffmpeg-macos-x86_64'
            }
        }
    },
    considerForOptimization : [ 'png', 'jpeg', 'jpg', 'avif', 'webp' ],
    transcodeOptions: {
        widths: [
            { width: 100 , enabled: true  },
            { width: 256 , enabled: false },
            { width: 320 , enabled: true  },
            { width: 426 , enabled: false },
            { width: 640 , enabled: true  },
            { width: 854 , enabled: false },
            { width: 1024, enabled: false },
            { width: 1280, enabled: true  },
            { width: 1440, enabled: false },
            { width: 1920, enabled: true  },
            { width: 2560, enabled: false },
            { width: 3840, enabled: false }
        ],
        formats: {
            avif: { enabled: true, codec: 'librav1e', quality : 150, minimum: 0, maximum: 255 },
            webp: { enabled: true, codec: 'libwebp' , quality : 40 , minimum: 0, maximum: 100 },
            jpeg: { enabled: true, codec: 'mjpeg'   , quality : 15 , minimum: 2, maximum: 31  }
        },
        preview: { format: 'webp', codec: 'libwebp', quality: 30 }
    }
} as const
