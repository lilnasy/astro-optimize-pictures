
/***** IMPORTS *****/

import type { HOT } from './deps.ts'


/***** MAIN *****/

const messages = {
    "CouldntFindAstroConfigFile": {
        
        "en-US":
            "Could not find astro configuration file after looking at these paths:\n{checkedPaths}\n\nAre you running this command inside your project?",
        
        "fr-FR":
            "Impossible de trouver le fichier de configuration astro après avoir examiné ces chemins:\n{checkedPaths}\n\nExécutez-vous cette commande à l'intérieur de votre projet?"
        
    },
    "CouldntParseImageInfo": {
        
        "en-US":
            "Getting information for {path} from ffmpeg's output failed.\n\nThe full command run was:\n{command}\n\nffmpeg's output was:\n{output}",
        
        "fr-FR":
            "Obtenir des informations pour {path} à partir de la sortie de ffmpeg a échoué.\n\nLa commande complète exécutée était:\n{command}\n\nLa sortie de ffmpeg était:\n{output}"
        
    },
    "FfmpegNotAvailableForPlatform": {
        
        "en-US":
            "{packageName} uses ffmpeg to process images. A build of ffmpeg is not available for your platform ({platform}).\n\n{packageName} provides builds for these platforms:\n{availablePlatforms}\n\nPlease create a github issue if you think your platform should be supported.",
        
        "fr-FR":
            "{packageName} utilise ffmpeg pour traiter les images. Une version de ffmpeg n'est pas disponible pour votre plate-forme ({platform}).\n\n{packageName} fournit des versions pour ces plateformes:\n{availablePlatforms}\n\nVeuillez créer un github issue si vous pensez que votre plate-forme devrait être prise en charge."
        
    },
    "CouldntConnectToInternet": {
        
        "en-US":
            "Could not make a request to {url} because of this error:\n{message}\n\nAre you able to access that url in a browser?",
        
        "fr-FR":
            "Impossible de faire une demande à {url} en raison de cette erreur:\n{message}\n\nÊtes-vous en mesure d'accéder à cette url dans un navigateur?"
        
    },
    "CouldntDownloadFfmpeg": {
        
        "en-US":
            "{packageName} uses ffmpeg to process images. Downloading ffmpeg from {url} failed.\n\nThis was the response sent by the server:\n{response}\n\nAre you able to access that url in a browser?",
        
        "fr-FR":
            "{packageName} utilise ffmpeg pour traiter les images. Le téléchargement de ffmpeg à partir de {url} a échoué.\n\nVoici la réponse envoyée par le serveur:\n{response}\n\nÊtes-vous en mesure d'accéder à cette url dans un navigateur?"
        
    },
    "CouldntWriteFfmpegToDisk": {
        
        "en-US":
            "{packageName} uses ffmpeg to process images. Downloading ffmpeg was successful, but saving it to disk failed.\n\nThis was the error that prevented ffmpeg from being written to {writingAt}:\n{error}\n\nPlease create a github issue.",
        
        "fr-FR":
            "{packageName} utilise ffmpeg pour traiter les images. Le téléchargement de ffmpeg a réussi, mais son enregistrement sur disque a échoué.\n\nVoici l'erreur qui a empêché ffmpeg d'être écrit à {writingAt}:\n{error}\n\nVeuillez créer un github issue."
        
    },
    "CouldntTranscodeImage": {
        
        "en-US":
            "Transcoding {path} failed.\n\nffmpeg's output was:\n{output}\n\nComplete log written to {logWrittenTo}.",
        
        "fr-FR":
            "Transcodage de {path} a échoué.\n\nLa sortie de ffmpeg était:\n{output}\n\nJournal complet écrit à {logWrittenTo}."
        
    },
    "NoteAboutFailedOptimizations": {
        
        "en-US":
            "Optimized versions of the images that failed to transcode will not be available in your project.\n\nYou can rerun {packageName} to try again. Only the failed optimizations will be retried. If the same error occurs again, please create a github issue.",
        
        "fr-FR":
            "Les versions optimisées des images qui n'ont pas réussi à transcoder ne seront pas disponibles dans votre projet.\n\nVous pouvez relancer {packageName} pour réessayer. Seules les optimisations échouées seront réessayées. Si la même erreur se produit à nouveau, veuillez créer un github issue."
        
    },
    "ReadyToOptimize": {
        
        "en-US":
            "Ready to optimize {imageCount} images in {folderCount} folders.",
        
        "fr-FR":
            "Prêt à optimiser {imageCount} images dans {folderCount} dossiers."
        
    },
    "StartOptimizing": {
        
        "en-US":
            "Start optimizing",
        
        "fr-FR":
            "Commencer l'optimisation"
        
    },
    "PickImages": {
        
        "en-US":
            "Pick images to optimize",
        
        "fr-FR":
            "Choisissez les images à optimiser"
        
    },
    "Configure": {
        
        "en-US":
            "Change quality and resolutions",
        
        "fr-FR":
            "Changer la qualité et les résolutions"
        
    },
    "Exit": {
        
        "en-US":
            "Exit",
        
        "fr-FR":
            "Sortie"
        
    },
    "InteractionInstructions": {
        
        "en-US":
            "Controls:\nUp, down, left, and right arrow keys to move around\nSpace to select or deselect the highlighted option\nEnter to continue",
        
        "fr-FR":
            "Contrôles:\nFlèches haut, bas, gauche et droite pour se déplacer\nEspace pour sélectionner ou désélectionner l'option surlignée\nEntrée pour continuer"
        
    },
    "NoteAboutWidths": {

        "en-US":
            "Widths larger than original image's width will be ignored.",
        
        "fr-FR":
            "Les largeurs supérieures à la largeur de l'image d'origine seront ignorées."
        
    },
    "RemainingCount": {

        "en-US":
            "+{remainingCount} images queued for optimization.",

        "fr-FR":
            "+{remainingCount} images en file d'attente pour l'optimisation."
        
    }
} as const


/***** TYPED MESSAGE TEMPLATES *****/

export function message<Topic extends keyof typeof messages>(
    topic   : Topic,
    details : Params<typeof messages[Topic]['en-US']> = {}
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


/***** UTILITY TYPES *****/

type Params<Template> = Record<Variables<Template>, string>

type Variables<Template> =
    HOT.Pipe<
        Template,
        [
            HOT.Strings.Split<'{'>,
            HOT.Tuples.Tail,
            HOT.Tuples.Map<HOT.Strings.Split<'}'>>,
            HOT.Tuples.Map<HOT.Tuples.Head>,
            HOT.Tuples.ToUnion
        ]
    >
