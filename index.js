const url = require('url');
const path = require('path');
const fs = require('fs')
const express = require('express')
const api = express();
const bodyParser = require("body-parser");
const fetch = require('node-fetch')
var shell = require('shelljs');
const  { networkInterfaces }  = require('os')
const net = require('net');

const applicationDir = "."
const MulticastPort = 53500
const MulticastIp = "232.0.53.5"
const SocketPort = 53501
const HttpPort = 53502
const ApiPort = 53510
const version = "1.1.3"
/*
Ports:
    Multicast: 53500
    socket: 53501
    http: 53502

    local api: 53510
IP:
    Multicast: 232.0.53.5
*/

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
    }
}

config.version = version;

if(!fs.existsSync(path.join(applicationDir, "covers"))) {
    shell.mkdir(path.join(applicationDir, "covers"))
}

let raw = {}

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

/////////////////////////////////////////////////////////////////////

api.use(bodyParser.urlencoded({ extended: true }));
api.use(bodyParser.json());
api.use(bodyParser.raw());

api.post(`/api/copytoclipboard`, async function(req, res) {
    res.end()
    clipboard.writeText(req.body.text)
    console.log("wrote " + req.body.text + " to clipboard")
})


api.get(`/api/getconfig`, async function(req, res) {
    try {
        res.json(config)
    } catch {}
})

api.get(`/windows/home`, async function(req, res) {
    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, "html", "index.html"),
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
