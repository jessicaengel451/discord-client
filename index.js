const electron = require('electron');
const url = require('url');
const path = require('path');
const fs = require('fs')
const express = require('express')
const api = express();
const bodyParser = require("body-parser");
const https = require('https')
const fetch = require('node-fetch')
var shell = require('shelljs');
const { clipboard } = electron
const  { networkInterfaces }  = require('os')
const { dialog, autoUpdater } = electron
const { app } = electron
const  {BrowserWindow } = electron
const net = require('net');
var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
const BeatSaverAPI = require('beatsaver-api');

const applicationDir = "."
const MulticastPort = 53500
const MulticastIp = "232.0.53.5"
const SocketPort = 53501
const HttpPort = 53502
const ApiPort = 53510
const version = "1.1.3"

const bsapi = new BeatSaverAPI({
    AppName: "Streamer-tools-client",
    Version: version
});
/*
Ports:
    Multicast: 53500
    socket: 53501
    http: 53502

    local api: 53510
IP:
    Multicast: 232.0.53.5
*/

autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
    const dialogOpts = {
            type: 'info',
            buttons: ['Restart', 'Later'],
            title: 'Application Update',
            message: process.platform === 'win32' ? releaseNotes : releaseName,
            detail: 'A new version has been downloaded. Restart the application to apply the updates.'
        }

        dialog.showMessageBox(dialogOpts).then((returnValue) => {
        if (returnValue.response === 0) autoUpdater.quitAndInstall()
    })
})

let mainWindow;

let config;

if(fs.existsSync(path.join(applicationDir, "config.json"))) {
    var configS = fs.readFileSync(path.join(applicationDir, "config.json"))
    try {
        config = JSON.parse(configS)
    } catch {
        for(let i = 0; i < 200; i++) {
            try {
                config = JSON.parse(configS.slice(0, -i))
                saveConfig()
            } catch {}
        }
        console.log("can't load config")
        
    }
} else {
    config = {
        "ip": "ip",
        "interval": "100",
        "dcrpe": false,
        "twitch": {
            "enabled": false,
            "token": "",
            "channelname": "yourChannelName"
        },
        "oconfig": {
            "customtext": "",
            "decimals": "2",
            "dontenergy": false,
            "dontmpcode": false,
            "alwaysmpcode": false,
            "alwaysupdate": false
        },
        "srm": {
            "requestdelay": 10000
        }
    }
}

config.version = version;

if(!fs.existsSync(path.join(applicationDir, "covers"))) {
    shell.mkdir(path.join(applicationDir, "covers"))
}

let raw = {}

var ipInQueue = ""

function SetupMulticast(localIP) {
    var PORT = MulticastPort;
    var HOST = localIP;
    var dgram = require('dgram');
    var client = dgram.createSocket('udp4');

    client.on('listening', function () {
        var address = client.address();
        client.setBroadcast(true)
        client.setMulticastTTL(128); 
        client.addMembership(MulticastIp, HOST);
        console.log('UDP Client listening on ' + address.address + ":" + address.port);
    });

    client.on('message', function (message, remote) {   
        console.log('Recieved multicast: ' + remote.address + ':' + remote.port +' - ' + message);
        ipInQueue = remote.address;
        NotifyClient();
    });

    client.bind(PORT, HOST);
}

function NotifyClient() {
    if(config.ip != ipInQueue) {
        var answer = dialog.showMessageBoxSync(mainWindow, {
            "message": "Incoming IP. Do you want to set this as your Quests IP? IP: " + ipInQueue,
            "buttons": ["Yes", "No"],
            "title": "Streamer tools client",
            "type": "question"
        })
        if(answer == 0) {
            config.ip = ipInQueue;
            saveConfig();
            dialog.showMessageBoxSync(mainWindow, {
                "message": "IP set to " + config.ip,
                "buttons": ["OK"],
                "title": "Streamer tools client"
            })
            mainWindow.reload();
        } else {
            console.log("IP not changed")
        }
    }
}

function GetLocalIPs() {
    const nets = networkInterfaces();
    const results = [];

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                results.push(net.address);
                console.log("adding " + net.address)
            }
        }
    }
    return results
}

GetLocalIPs().forEach(ip => {
    SetupMulticast(ip)
})

var lastError = ""

var connected = false
var fetching = false;

var checkData = false;
var sent = false;

function checkSending() {
    if(checkData) return;
    checkData = true;
    return new Promise((resolve, reject) => {
        sent = false;
        setTimeout(() => {
            checkData = false;
            resolve(sent);
        }, 2000);
    })
}

var lastid = "";
var coverBase64 = "";
var got404 = false;

var fetchedKey = false
var key = false
var coverFetchableLocalhost = false

 async function GetBeatSaverKey(got404) {
    if(!got404) {
        fetchedKey = false
        fetch("https://api.beatsaver.com/maps/hash/" + raw.id.replace("custom_level_", ""), {headers: { 'User-Agent': 'Streamer-tools-client/1.0 (+https://github.com/ComputerElite/streamer-tools-client/)' }}).then((result) => {
            result.json().then((json) => {
                try {
                    key = json.id
                    fetchedKey = true
                } catch {}
            }).catch((err) => {})
        }).catch((err) => {})
    }
}

function fetchData() {
    if(connected || fetching) return;
    fetching = true;
    fetch("http://" + config.ip + ":" + HttpPort + "/data").then((res) => {
        fetching = false;
        res.json().then((json) => {
            raw = json
            raw.connected = connected

            console.log("connecting with Quest")
            var socket = net.Socket();
            try {
                connected = true
                socket.connect(SocketPort, config.ip, function() {
                    console.log("connected")
                });
    
                socket.on('close', function() {
                    console.log('Lost connection with Quest');
                    connected = false;
                    raw.connected = connected
                });
    
                let buffer = Buffer.alloc(0);
                socket.on('data', async function(data){
                    buffer = Buffer.concat([buffer, data]);
                    while (buffer.length >= 4) {
                        try {
                            const messageLength = buffer.readUIntBE(0, 4);
                            if (buffer.length < 4 + messageLength) {
                                break;
                            }
                            raw = JSON.parse(buffer.toString("utf-8", 4, messageLength + 4))
                            buffer = buffer.subarray(4 + messageLength);
                            
                            sent = true;
                            
                            if(lastid != raw.id || got404) {
                                coverFetchableLocalhost = false
                                for(let i = 0; i < srm.length; i++) {
                                    if(srm[i].hash.toLowerCase() == raw.id.replace("custom_song_", "").toLowerCase()) {
                                        srm.splice(i, 1)
                                    }
                                }
                                GetBeatSaverKey(got404);
                                lastid = raw.id
                            }
                            if(raw.coverFetchable && !coverFetchableLocalhost) {
                                console.log(raw.coverFetchable)
                                fetch("http://" + config.ip + ":" + HttpPort + "/cover/base64").then((res2) => {
                                    res2.text().then((text) => {
                                        if(res2.status != 200) {
                                            coverBase64 = "";
                                            got404 = true;
                                            coverFetchableLocalhost = false
                                        } else {
                                            coverBase64 = text;
                                            coverFetchableLocalhost = true
                                            got404 = false;
                                        }
                                    })
                                })
                            }
                            raw.connected = connected
                            raw.fetchedKey = fetchedKey
                            raw.key = key
                            raw.coverFetchableLocalhost = coverFetchableLocalhost
                        } catch (err) {
                            if(lastError != err.toString()) {
                                lastError = err.toString();
                                console.error("couldn't read/parse data from socket: " + lastError)
                            }
                        }
                    }
                })

                var connectionChecker = setInterval(() => {
                    try {
                        checkSending().then((res) => {
                            if(!res) {
                                console.log("Destroying socket to reconnect")
                                socket.destroy();
                                clearInterval(connectionChecker)
                                return;
                            }
                        })
                    } catch {}
                }, 1000);
            } catch {
                connected = false;
            }
            
        })
    }).catch((err) => {
        fetching = false;
        console.log("unable to connect to quest")
        if(lastError != err.toString()) {
            lastError = err.toString();
            console.error("unable to connect to quest: " + lastError)
        }
    })
}

setInterval(() => {
    fetchData()
}, config.interval);

function saveConfig() {
    writeToFile(path.join(applicationDir, "config.json"), JSON.stringify(config))
}

function writeToFile(file, contents) {
    fs.writeFileSync(file, contents)
}


function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest, { flags: "wx" });
        var parsed = new URL(url)

        const options = {
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname,
            method: 'GET',
            headers: {
                'User-Agent': `streamer-tools-client/${version} (+https://github.com/ComputerElite/streamer-tools-client/)`
            }
          }
        const request = https.get(options, response => {
            if (response.statusCode === 200) {
                response.pipe(file);
            } else {
                file.close();
                fs.unlink(dest, () => {}); // Delete temp file
                reject(`Server responded with ${response.statusCode}: ${response.statusMessage}`);
            }
        });

        request.on("error", err => {
            file.close();
            fs.unlink(dest, () => {}); // Delete temp file
            reject(err.message);
        });

        file.on("finish", () => {
            resolve();
        });

        file.on("error", err => {
            file.close();

            if (err.code === "EEXIST") {
                reject("File already exists");
            } else {
                fs.unlink(dest, () => {}); // Delete temp file
                reject(err.message);
            }
        });
    });
}

//////////////////////////////////////Discord rich presence///////////////////////////////////////
if(config.dcrpe != undefined && config.dcrpe) {
    console.log("enabling dcrp")
    const dcrp = require('discord-rich-presence')('846852034330492928')

    setInterval(() => {
        UpdatePresence();
    }, 1000);

    function intToDiff(diff) {
        switch (diff)
        {
            case 0:
                return "Easy";
            case 1:
                return "Normal";
            case 2:
                return "Hard";
            case 3:
                return "Expert";
            case 4:
                return "Expert +";
        }
        return "Unknown";
    }

    function trim(input) {
        return input.toFixed(2)
    }

    function UpdatePresence() {
        // Application
        // details
        // State
        var songStart = new Date();
        songStart.setSeconds(songStart.getSeconds() - raw.time)
        var songEnd = new Date();
        songEnd.setSeconds(songEnd.getSeconds() - raw.time + raw.endTime)
        var smallText = "Presence by streamer tools,\nclient by ComputerElite"
        switch(raw.location) {
            case 0:
                // menu
                dcrp.updatePresence({
                    state: raw.songAuthor + " [" + raw.levelAuthor + "]",
                    details: raw["levelName"] + " (" + intToDiff(raw.difficulty) + ")",
                    startTimestamp: songStart,
                    endTimestamp: songEnd,
                    smallImageText: smallText,
                    smallImageKey: 'stc',
                    largeImageText: 'Score: ' + raw.score + " acc: " + trim(raw.accuracy * 100) + " %",
                    largeImageKey: 'bs',
                    instance: true
                })
                break;
            case 1:
                // Solo song
                dcrp.updatePresence({
                    state: raw.songAuthor + " [" + raw.levelAuthor + "]",
                    details: raw["levelName"] + " (" + intToDiff(raw.difficulty) + ")",
                    startTimestamp: songStart,
                    endTimestamp: songEnd,
                    smallImageText: smallText,
                    smallImageKey: 'stc',
                    largeImageText: 'Score: ' + raw.score + " acc: " + trim(raw.accuracy * 100) + " %",
                    largeImageKey: 'bs',
                    instance: true
                })
                break;
            case 2:
                // mp song
                dcrp.updatePresence({
                    state: raw.songAuthor + " [" + raw.levelAuthor + "]",
                    details: "[MP] " + raw["levelName"] + " (" + intToDiff(raw.difficulty) + ")",
                    startTimestamp: songStart,
                    endTimestamp: songEnd,
                    smallImageText: smallText,
                    smallImageKey: 'stc',
                    largeImageText: 'Score: ' + raw.score + " acc: " + trim(raw.accuracy * 100) + " %",
                    largeImageKey: 'bs',
                    instance: true
                })
                break;
            case 3:
                // tutorial
                dcrp.updatePresence({
                    state: "learning how to beat saber",
                    details: "In tutorial",
                    smallImageText: smallText,
                    smallImageKey: 'stc',
                    largeImageText: 'Score: ' + raw.score + " acc: " + trim(raw.accuracy * 100) + " %",
                    largeImageKey: 'bs',
                    instance: true
                })
                break;
            case 4:
                // campaign
                dcrp.updatePresence({
                    state: raw.songAuthor + " [" + raw.levelAuthor + "]",
                    details: "[Campaign] " + raw["levelName"] + " (" + intToDiff(raw.difficulty) + ")",
                    startTimestamp: songStart,
                    endTimestamp: songEnd,
                    smallImageText: smallText,
                    smallImageKey: 'stc',
                    largeImageText: 'Score: ' + raw.score + " acc: " + trim(raw.accuracy * 100) + " %",
                    largeImageKey: 'bs',
                    instance: true
                })
                break;
            case 5:
                // mp lobby
                dcrp.updatePresence({
                    state: raw.players + "/" + raw.maxPlayers + " players",
                    details: "In multiplayer lobby",
                    smallImageText: smallText,
                    smallImageKey: 'stc',
                    largeImageKey: 'bs',
                    instance: false
                })
                break;
            case 7:
                // mp spectating
                dcrp.updatePresence({
                    state: raw.players + "/" + raw.maxPlayers + " players",
                    details: "Spectating others",
                    smallImageText: smallText,
                    smallImageKey: 'stc',
                    largeImageKey: 'bs',
                    instance: false
                })
                break;
            default:
                if(raw.connected) {
                    dcrp.updatePresence({
                        state: "Selecting songs",
                        details: "In menu",
                        smallImageText: smallText,
                        smallImageKey: 'stc',
                        largeImageKey: 'bs',
                        instance: false
                    })
                } else {
                    dcrp.updatePresence({
                        state: "Quest is not connected",
                        details: "No info available",
                        smallImageText: smallText,
                        smallImageKey: 'stc',
                        largeImageKey: 'bs',
                        instance: false
                    })
                }
                break;
        }
    }
}


/////////////////// Twitch bot////////////////////////
function BSaverRequest(key) {
    return bsapi.getMapByID(key)
    
}

var srm = []

if(config.twitch != undefined && config.twitch.token != undefined && config.twitch.channelname != undefined && config.twitch.enabled) {
    const tmi = require('tmi.js');

    const client = new tmi.Client({
    options: { debug: true },
    connection: {
        secure: true,
        reconnect: true
    },
    identity: {
        username: 'streamer-tools-client',
        password: config.twitch.token
    },
    channels: [config.twitch.channelname]
    });

    client.connect();
    

    var lastRequest = new Date();

    client.on('message', (channel, tags, message, self) => {
        if(self) return;

        console.log("recived message via twitch: [" + channel + "] <" + tags.username + "> " + message)
        if(message.toLowerCase().startsWith("!bsr")) {
            console.log("bsr")
            var msg = message.split(" ");
            if(msg.length >= 2) {
                var key = msg[1].toLowerCase()
                for(let i = 0; i < srm.length; i++) {
                    if(srm[i].key == key) {
                        srm[i].requested++;
                        client.say(channel, `@${tags.username} requested ${srm[i].key}. It has now been requested ${srm[i].requested}`)
                        return
                    }
                }

                if((new Date().getTime() - lastRequest.getTime()) < config.srm.requestdelay) {
                    client.say(channel, `@${tags.username} ${config.twitch.channelname} only allows ${(60000 / config.srm.requestdelay)} requests per minute`)
                    return
                }
                lastRequest = new Date()
                BSaverRequest(key).then((res) => {
                        console.log(`@${tags.username} requested ${res.name} (${key})`)
                        
                        if(config.srm != undefined && config.srm.maxsonglength != undefined && res.metadata.duration > config.srm.maxsonglength) {
                            console.log(`Song is too long`)
                            client.say(channel, `@${tags.username} the song you requested is ${res.metadata.duration - config.srm.maxsonglength} seconds too long. Only a maximum length of ${config.srm.maxsonglength} seconds is allowed`)
                            return;
                        }
                        client.say(channel, `@${tags.username} requested ${res.name} (${key})`)
                        if(!fs.existsSync(path.join(applicationDir, "covers", res.key + ".png"))) {
                            console.log("downloading cover of song " + res.key)
                            downloadFile(res.versions[0].coverURL, path.join(applicationDir, "covers", res.key + ".png"))
                        }
                        var request = {
                            "name": res.name,
                            "key": res.id,
                            "coverURL": `http://localhost:${ApiPort}/covers/${res.key}.png`,
                            "requested": 1,
                            "length": res.metadata.duration,
                            "hash": res.hash
                        }
                        srm.unshift(request)
                })
                
            }
        }
    });
}


/////////////////////////////////////////////////////////////////////

app.on('ready', () => {
    mainWindow = new BrowserWindow({
        icon: path.join(__dirname, 'assets', 'STC.ico')
    });
    //mainWindow.removeMenu()
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, "html", "index.html"),
        protocol: 'file',
        slashes: true
    }))

})

api.use(bodyParser.urlencoded({ extended: true }));
api.use(bodyParser.json());
api.use(bodyParser.raw());

function SyncConfigFromQuest(json) {
    var xhr = new XMLHttpRequest();
    xhr.open("PATCH", "http://localhost:53510/api/patchconfig", true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({
        "oconfig": {
            "decimals": json.decimals,
            "dontenergy": json.dontenergy,
            "dontmpcode": json.dontmpcode,
            "alwaysmpcode": json.alwaysmpcode,
            "alwaysupdate": json.alwaysupdate
        },
        "log": false,
        "updateQuestConfig": false
    }));
}

function SyncConfigToQuest() {
    var xhr = new XMLHttpRequest();
    xhr.open("PATCH", "http://" + config.ip + ":" + HttpPort + "/config", true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({
        "decimals": config.oconfig.decimals,
        "dontenergy": config.oconfig.dontenergy,
        "dontmpcode": config.oconfig.dontmpcode,
        "alwaysmpcode": config.oconfig.alwaysmpcode,
        "alwaysupdate": config.oconfig.alwaysupdate,
        "lastChanged": config.oconfig.lastChanged
    }));
}

// Really really chonky
api.patch(`/api/patchconfig`, async function(req, res) {
    res.end()
    if(config.twitch == undefined) {
        config.twitch = {}
    }
    if(config.oconfig == undefined) {
        config.oconfig = {}
    }
    var log = req.body.log;
    if(req.body.ip != undefined) {
        var ipReg = /^((2(5[0-5]|[0-4][0-9])|1?[0-9]?[0-9])\.){3}(2(5[0-5]|[0-4][0-9])|1?[0-9]?[0-9])$/g
    
        if(!ipReg.test(req.body.ip)) {
            if(log) console.log("warning: config.ip (" + req.body.ip + ") is no ipv4 ip.")
        }
        config.ip = req.body.ip
        if(log) console.log("config.ip set to: " + config.ip)
    }
    if(req.body.interval != undefined) {
        config.interval = req.body.interval
        if(log) console.log("config.interval set to: " + config.interval)
    }
    if(req.body.dcrpe != undefined) {
        config.dcrpe = req.body.dcrpe
        if(log) console.log("config.dcrpe set to: " + config.dcrpe)
    }
    if(req.body.srm != undefined) {
        if(config.srm == undefined) config.srm = {}
        if(req.body.srm.requestdelay != undefined) {
            config.srm.requestdelay = req.body.srm.requestdelay
            if(log) console.log("config.srm.requestdelay set to: " + config.srm.requestdelay)
        }
        if(req.body.srm.maxsonglength != undefined) {
            config.srm.maxsonglength = req.body.srm.maxsonglength
            if(log) console.log("config.srm.maxsonglength set to: " + config.srm.maxsonglength)
        }
    }

    saveConfig()
}).catch

api.post(`/api/copytoclipboard`, async function(req, res) {
    res.end()
    clipboard.writeText(req.body.text)
    console.log("wrote " + req.body.text + " to clipboard")
})

api.post(`/api/removerequest`, async function(req, res) {
    res.end()
    for(let i = 0; i < srm.length; i++) {
        if(req.body.key == srm[i].key) {
            srm.splice(i, 1)
            console.log("removed song request at index " + i + " (" + req.body.key + ")")
            return;
        }
    }
    console.log("removed none")
})

api.get(`/api/getconfig`, async function(req, res) {
    try {
        res.json(config)
    } catch {}
})

function constuctParameters() {
    return "?ip=" + config.ip + "&updaterate=" + config.interval + "&decimals=" + config.oconfig.decimals + (config.oconfig.dontenergy ? "&dontshowenergy" : "") + (config.oconfig.dontmpcode ? "&dontshowmpcode" : "") + (config.oconfig.alwaysmpcode ? "&alwaysshowmpcode" : "") + (config.oconfig.customtext != "" ? "&customtext=" + config.oconfig.customtext : "") + (config.oconfig.alwaysupdate ? "&alwaysupdate" : "") + "&nosetip"
}

api.get(`/windows/home`, async function(req, res) {
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, "html", "index.html"),
        protocol: 'file',
        slashes: true
    }))
    res.end()
})
api.get(`/windows/stream`, async function(req, res) {
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, "html", "stream.html"),
        protocol: 'file',
        slashes: true
    }))
    res.end()
})

api.get(`/windows/downloads`, async function(req, res) {
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, "html", "downloads.html"),
        protocol: 'file',
        slashes: true
    }))
    res.end()
})

api.get(`/windows/srm`, async function(req, res) {
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, "html", "srm.html"),
        protocol: 'file',
        slashes: true
    }))
    res.end()
})

api.get(`/api/raw`, async function(req, res) {
    var Url = new URL("http://localhost:" + ApiPort + req.url)
    var ip = Url.searchParams.get("ip")
    if(ip != null && ip != "" && ip != "null" && Url.searchParams.get("nosetip") == null) {
        config.ip = ip;
    }
    res.header("Access-Control-Allow-Origin", "*")
    try {
        res.json(raw)
    } catch {}
})

api.get(`/api/rawcover`, async function(req, res) {
    res.header("Access-Control-Allow-Origin", "*")
    //if(coverBase64 == "") res.statusCode = 404
    try {
        res.send(coverBase64)
    } catch {}
    
})
api.use("/covers", express.static(path.join(applicationDir, "covers")))

api.listen(ApiPort)
