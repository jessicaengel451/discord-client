# streamer-tools-client
A Client for the Streamer tools Beat Saber mod

# Installation
## Downloading the client
### Windows
1. Get the latest binaries from [Actions](https://github.com/ComputerElite/streamer-tools-client/actions) (Simply click the latest entry and then download the zip file at the bottom)
2. Extract the zip file
3. Run the exe and you should be set up
4. 
### Mac and Linux
1. Download the quest mod from [The streamer tools repo](https://github.com/EnderdracheLP/streamer-tools/releases/latest) and upload it to BMBF.
2. [Install Node.js](https://nodejs.org/en/download/)
3. Download all files from this repo, unzip them and run install.bat
4. To run the client simply start start.bat

## Setting up the client
After starting the client with start.bat simply put in your Quests ip and hit save.
Then you can download overlays from the download section and see them in the overlays section.

## Adding overlays to obs
In your scene add a browser and as URL set the one you copied from the overlays section in the client

# Documentation
## Getting data from the quest through the client
The client starts a web server on your PC and starts to fetch from your Quest right away. You can access the latest data from `localhost:53510/api/raw`

## Setting the quest ip
Send a post request with a json to `localhost:53510/api/postip`. e. g. 
```json
{
  "ip": "192.168.2.1"
}
```

## Getting the quest ip
`localhost:53510/api/getip` will give you the ip back in a json format. e. g. 
```json
{
  "ip": "192.168.2.1"
}
```

## Getting installed overlays
`localhost:53510/api/overlays` will return an array of overlays (contains names, download urls and more) which will look like this:
```json
[
        {
            "Name": "Original_Overlay",
            "downloaded": true,
            "downloads": [
                {
                    "URL": "https://computerelite.github.io/tools/Streamer_Tools_Quest_Overlay/Overlay1.html",
                    "Path": "tools/Streamer_Tools_Quest_Overlay/Overlay2.html",
                    "IsEntryPoint": true
                },
                {
                    "URL": "https://computerelite.github.io/css/standard.css",
                    "Path": "css/standard.css",
                    "IsEntryPoint": false
                },
                {
                    "URL": "https://computerelite.github.io/tools/Streamer_Tools_Quest_Overlay/pulling.js",
                    "Path": "tools/Streamer_Tools_Quest_Overlay/pulling.js",
                    "IsEntryPoint": false
                },
                {
                    "URL": "https://computerelite.github.io/tools/Streamer_Tools_Quest_Overlay/default.png",
                    "Path": "tools/Streamer_Tools_Quest_Overlay/default.png",
                    "IsEntryPoint": false
                }
            ]
        }
    ]
```

## Getting a specific overlay
`localhost:53510/api/getOverlay?name=[OverlayName]` will redirect you to the Overlay you specified if it exists.

## Downloading an overlay
Make a post request to `localhost:53510/api/download` with a json. e. g.
```json
{
  "Name": "Original_Overlay"
}
```
