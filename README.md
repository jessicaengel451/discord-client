# discord-client
A Discord Client from the Streamer tools Beat Saber mod. I just stripped it down

# Installation
## Downloading the client
### Mac, Windows and Linux
1. [Install Node.js](https://nodejs.org/en/download/)
2. Download all files from this repo, and run npm install
3. To run the client simply npm start

## Setting up the client
After starting the client simply put in your Quests ip and hit save.
Then you can download overlays from the download section and see them in the overlays section.

# Documentation
## Getting data from the quest through the client
The client starts a web server on your PC and starts to fetch from your Quest right away. You can access the latest data from `localhost:53510/api/raw`

## Setting the config
Send a post request with a json of the values to set to `localhost:53510/api/postconfig`. e. g. 
```json
{
  "ip": "192.168.2.1"
}
```

## Getting the config
`localhost:53510/api/getconfig` will give you the config back in a json format.