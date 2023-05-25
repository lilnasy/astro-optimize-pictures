export default {
    packageName        : 'astro-optimize-images',
    optimizedFolderName: '_optimized_images',
    ffmpeg: {
        env: 'FFMPEG_PATH',
        downloadUrl: {
            windows: {
                x64: 'https://evermeet.cx/pub/ffmpeg/ffmpeg-6.0.zip'
            },
            linux: {
                x64: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2023-04-09-12-46/ffmpeg-n6.0-12-ga6dc92968a-linux64-gpl-6.0.tar.xz',
                arm: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2023-04-09-12-46/ffmpeg-n6.0-12-ga6dc92968a-linuxarm64-gpl-6.0.tar.xz'
            }
        }
    },
    considerForOptimization : [ 'png', 'jpeg', 'jpg', 'avif', 'webp' ],
    transcoding: {
        widths: [
            { width: 100 , enabled: true  },
            { width: 256 , enabled: true  },
            { width: 426 , enabled: true  },
            { width: 640 , enabled: true  },
            { width: 854 , enabled: true  },
            { width: 1280, enabled: true  },
            { width: 1920, enabled: true  },
            { width: 2560, enabled: false },
            { width: 3840, enabled: false }
        ],
        formats: {
            jpeg: { enabled: true, codec: 'mjpeg'   , quality : 15 , minimum: 2, maximum: 31  },
            webp: { enabled: true, codec: 'libwebp' , quality : 30 , minimum: 0, maximum: 100 },
            avif: { enabled: true, codec: 'librav1e', quality : 150, minimum: 0, maximum: 255 }
        }
    }
} as const
