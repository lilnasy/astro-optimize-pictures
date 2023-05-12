export default {
    "CouldntConnectToInternet": {
        
        "en-US":
            "Could not make a request to {url} because of this error:\n{message}\n\nAre you able to access that url in a browser?",
        
        "fr-FR":
            "Impossible de faire une demande à {url} en raison de cette erreur:\n{message}\n\nÊtes-vous en mesure d'accéder à cette url dans un navigateur?"
        
    },
    "CouldntDownloadFfmpeg": {
        
        "en-US":
            "{projectName} uses ffmpeg to process images.\nDownloading ffmpeg for your computer failed.\n\nThis was the response sent by the server:\n{response}.\n\nYou could try manually installing ffmpeg.",
        
        "fr-FR":
            "{projectName} utilise ffmpeg pour traiter les images.\nTéléchargement de ffmpeg pour votre ordinateur a échoué.\n\nVoici la réponse envoyée par le serveur:\n{response}.\n\nVous pouvez essayer d'installer manuellement ffmpeg."        
    },
    "CouldntFindAstroConfigFile": {
        
        "en-US":
            "Could not find astro configuration file after looking at these paths:\n{checkedPaths}\n\nIs your current working directory inside your project?",
        
        "fr-FR":
            "Impossible de trouver le fichier de configuration astro après avoir examiné ces chemins:\n{checkedPaths}\n\nVotre répertoire de travail actuel est-il à l'intérieur de votre projet?"
        
    },
    "CouldntParseImageInfo": {
        
        "en-US":
            "Getting information for {path} from ffmpeg's output failed.\n\nThe full command run was:\n{command}\n\nffmpeg's output was:\n{output}",
        
        "fr-FR":
            "Obtenir des informations pour {path} à partir de la sortie de ffmpeg a échoué.\n\nLa commande complète exécutée était:\n{command}\n\nLa sortie de ffmpeg était:\n{output}"
    },
    "CouldntTranscodeImage": {
        
        "en-US":
            "Transcoding {path} failed.\n\nThe full command run was:\n{command}\n\nffmpeg's output was:\n{output}",
        
        "fr-FR":
            "Transcodage de {path} a échoué.\n\nLa commande complète exécutée était:\n{command}\n\nLa sortie de ffmpeg était:\n{output}"
        
    },
    "CouldntWriteFfmpegToDisk": {
        
        "en-US":
            "{projectName} uses ffmpeg to process images.\nDownloading ffmpeg was successful, but saving it to disk failed.\n\nThis was the error that prevented ffmpeg from being written to disk:\n{error}\n\nYou could try manually installing ffmpeg.",
        
        "fr-FR":
            "{projectName} utilise ffmpeg pour traiter les images.\nTéléchargement de ffmpeg a réussi, mais son enregistrement sur le disque a échoué.\n\nVoici l'erreur qui a empêché ffmpeg d'être écrit sur le disque:\n{error}\n\nVous pouvez essayer d'installer manuellement ffmpeg."
        
    },
    "FindingImages": {
        
        "en-US":
            "Looking for images...\n\nFound a total of {imageCount} images in {folderCount} folders in your project so far.",
        
        "fr-FR":
            "Recherche d'images...\n\nTrouvé un total de {imageCount} images dans {folderCount} dossiers dans votre projet jusqu'à présent."
        
    },
    "ReadyToOptimize": {
        
        "en-US":
            "Ready to optimize {imageCount} images in {folderCount} folders.",
        
        "fr-FR":
            "Prêt à optimiser {imageCount} images dans {folderCount} dossiers."
        
    },
    "Start optimizing": {

        "en-US":
            "Start optimizing",

        "fr-FR":
            "Commencer l'optimisation"
        
    },
    "Pick images": {
        
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
    "Interaction instructions": {
        
        "en-US":
            "Use the up and down keys to move the cursor, space to select or unselect an image or folder, and enter to continue.",
        
        "fr-FR":
            "Utilisez les touches haut et bas pour déplacer le curseur, l'espace pour sélectionner ou désélectionner une image ou un dossier, et entrée pour continuer."
        
    }
} as const
