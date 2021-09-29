"use strict";

const csv = require("csvtojson");
const fetch = require("node-fetch");
const yargs = require("yargs/yargs");
const {CookieMap} = require("cookiefile");
const {hideBin} = require("yargs/helpers");

const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36";
const DEFAULT_ZOOM_ORIGIN = "https://berkeley.zoom.us";

function getBaseHeaders(zoomOptions) {
  let {
    cookieString,
    userAgent,
    zoomOrigin,
  } = zoomOptions;

  return {
    "User-Agent": userAgent,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.5",
    "X-Requested-With": "XMLHttpRequest, XMLHttpRequest, OWASP CSRFGuard Project",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Referer": `${zoomOrigin}/meeting`,
    "Origin": zoomOrigin,
    "Cookie": cookieString,
  };
}
module.exports.getBaseHeaders = getBaseHeaders;

async function getCSRFToken(zoomOptions) {
  let res = await request("/csrf_js", zoomOptions, {
    headers: {
      "FETCH-CSRF-TOKEN": "1",
    },
    body: "",
  });
  if(!res.ok) throw new Error(`HTTP ${res.status} (${res.method} ${res.url})`);
  let data = await res.text();
  let csrfTokenMatch = data.match(/^ZOOM-CSRFTOKEN:([0-9A-Za-z_-]+)$/);
  if(!csrfTokenMatch) throw new Error("Couldn't get CSRF token");
  return csrfTokenMatch[1];
}

async function request(url, zoomOptions, options = {}) {
  zoomOptions = Object.assign({
    userAgent: DEFAULT_USER_AGENT,
    zoomOrigin: DEFAULT_ZOOM_ORIGIN,
  }, zoomOptions);

  options.headers = Object.assign({}, getBaseHeaders(zoomOptions), options.headers);

  url = new URL(url, zoomOptions.zoomOrigin);

  let csrfToken = options.csrfToken;
  if(csrfToken) {
    options.headers["ZOOM-CSRFTOKEN"] = csrfToken === true ? await getCSRFToken(zoomOptions) : csrfToken;
  }

  if(options.body !== undefined) {
    options.method = "POST";
    if(options.headers["Content-Type"] === undefined) {
      options.headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    }
  }

  let res = await fetch(url, options);
  if(!res.ok) throw new Error(`HTTP ${res.status} (${res.method} ${res.url})`);
  return res;
}
module.exports.request = request;

async function getJSON(res) {
  let data = await res.json();
  if(!data.status || data.errorCode !== 0 || data.errorMessage) {
    if(data.errorCode === 201) throw new Error(`Session expired, log in and update your cookies`);
    throw new Error(`Zoom error: ${data.errorMessage} (code: ${data.errorCode})`);
  }
  return data;
}
module.exports.getJSON = getJSON;

async function readInputCSV(path, rowCallback) {
  let rows = await csv().fromFile(path);
  return rows.map((_row, i) => {
    let row = Object.fromEntries(Object.entries(_row).map(([k, v]) => {
      k = k.replace(/\s/g, "");
      return [`${k[0].toLowerCase()}${k.slice(1)}`, v];
    }));
    if(rowCallback) rowCallback(row, i);
    return row;
  });
}
module.exports.readInputCSV = readInputCSV;

function getCookieString(path) {
  return new CookieMap(path).toRequestHeader().replace("Cookie: ", "");
}
module.exports.getCookieString = getCookieString;

function cli(...args) {
  return yargs(hideBin(process.argv), ...args);
}
module.exports.cli = cli;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
module.exports.sleep = sleep;
