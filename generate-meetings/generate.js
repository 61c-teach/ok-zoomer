"use strict";

const csv = require("csvtojson");
const fs = require("fs");
const fetch = require("node-fetch");
const yargs = require("yargs/yargs");
const {CookieMap} = require("cookiefile");
const {hideBin} = require("yargs/helpers");

async function run() {
  let options = yargs(hideBin(process.argv))
    .option("input", {alias: "i", default: "roster.csv", describe: "Input CSV (requires Email column)"})
    .option("output", {alias: "o", default: "stdout", describe: "Output CSV (creates Email, Meeting columns)"})
    .option("cookies", {default: "cookies.txt", describe: "Netscape cookies.txt file"})
    .option("topic", {alias: "t", default: "Meeting (@)", describe: "Name of meeting (@ for email)"})
    .option("description", {describe: "Description of meeting (@ for email)"})
    .option("when", {alias: "w", default: null, describe: "Date/time of meeting, as ISO timestamp"})
    .option("duration", {alias: "d", number: true, default: 0, describe: "Duration of meeting, in minutes (multiple of 15). If 0, meeting will not have a set date/time"})
    .option("timezone", {default: Intl.DateTimeFormat().resolvedOptions().timeZone, describe: "Timezone of meeting"})
    .option("cohost", {alias: "c", boolean: true, describe: "Add emails as co-hosts"})
    .option("csrfToken", {hidden: true})
    .strict()
    .version(false)
    .argv;

  options.cookieString = new CookieMap(options.cookies).toRequestHeader().replace("Cookie: ", "");

  let input = null;
  try {
    input = (await csv().fromFile(options.input)).map((_row, i) => {
      let email = _row["Email"];
      if(!email) throw new Error(`Invalid email found (row: ${i}, email: ${JSON.stringify(email)})`);
      let row = Object.fromEntries(Object.entries(_row).map(([k, v]) => [k.toLowerCase(), v]));
      if(row.duration) row.duration = +row.duration;
      if(row.cohost) row.cohost = row.cohost.toLowerCase() === "true";
      return row;
    });
  } catch(err) {
    console.error(`Couldn't parse ${options.input}: ${err.stack}`)
    return;
  }

  let outStream = process.stdout;
  if(options.output && options.output !== "stdout") outStream = fs.createWriteStream(options.output);
  outStream.write("Email,Meeting\n");

  for(let row of input) {
    let email = row.email;
    try {
      let meetingOptions = {
        ...options,
        ...row,
        altHosts: options.cohost ? [email] : [],
      };
      if(meetingOptions.topic) meetingOptions.topic = meetingOptions.topic.replace("@", email);
      if(meetingOptions.description) meetingOptions.description = meetingOptions.description.replace("@", email);
      let meeting = await createMeeting(meetingOptions);
      console.error(`[${email}] created meeting (${meeting.link})`);
      outStream.write(`${email},${meeting.link}\n`);
    } catch(err) {
      console.error(`[${email}] failed to create meeting: ${err.stack}`);
    }
  }
}
run().catch((err) => {
  console.error(err);
  process.exit(1);
});

const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36";
const DEFAULT_ZOOM_ORIGIN = "https://berkeley.zoom.us";

async function createMeeting(options) {
  let {
    topic,
    description,
    when,
    timezone,
    duration,
    password,
    altHosts,
    autoRecordMode,
    audioType,

    allowJoinBeforeHost,
    allowJoinBeforeHostBeforeMeeting,
    hostVideo,
    participantVideo,
    allowAltHostToEditPoll,
    enablePAC,
    enableWaitingRoom,
    dialInOptions,
    authOptions,
    enforceSignInMode,
    breakoutRoomOptions,
    requireRegistration,
    usePersonalMeetingID,
    enableMuteUponEntry,
    regionAllowList,
    regionDenyList,

    cookieString,
    csrfToken,
    userAgent,
    zoomOrigin,
  } = {
    password: Math.floor(Math.random() * 1000000).toString().padStart(6, "0"),
    altHosts: [],
    autoRecordMode: "cloud", // none, local, cloud
    audioType: "both", // telephony, voip, both

    allowJoinBeforeHost: true,
    allowJoinBeforeHostBeforeMeeting: true,
    hostVideo: true, // on, off
    participantVideo: true, // on, off
    allowAltHostToEditPoll: false,
    enablePAC: false, // ???
    enableWaitingRoom: false, // 0, 1
    dialInOptions: null,
    authOptions: null,
    enforceSignInMode: 0, // 0 (any Zoom user), 1 (Berkeley Zoom user)
    breakoutRoomOptions: null,
    requireRegistration: false,
    usePersonalMeetingID: false,
    enableMuteUponEntry: false, // 0, 1
    regionAllowList: [],
    regionDenyList: [],

    csrfToken: null,
    userAgent: DEFAULT_USER_AGENT,
    zoomOrigin: DEFAULT_ZOOM_ORIGIN,

    ...options,
  };

  if(when === null) when = new Date();
  if(!(when instanceof Date)) {
    if(isNaN(+when)) {
      when = new Date(when);
    } else if(when < Date.now() / 1000 * 2) {
      when = new Date(+when * 1000);
    } else {
      when = new Date(+when);
    }
  }
  if(!when || isNaN(when.getTime())) throw new Error(`Invalid date: ${options.when}`);
  if(isNaN(options.duration)) throw new Error(`Invalid duration: ${options.duration}`);
  let startDate = when.toLocaleDateString("en-US", {timeZone: options.timezone});
  let [startTime, startAMPM] = when.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "numeric",
    timeZone: options.timezone,
  }).split(" ");

  let baseHeaders = {
    "User-Agent": userAgent,
    "Referer": `${zoomOrigin}/meeting/schedule`,
    "Origin": zoomOrigin,
    "Cookie": cookieString,
  };

  if(!csrfToken) {
    let res = await fetch(`${zoomOrigin}/csrf_js`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "FETCH-CSRF-TOKEN": "1",
      },
      body: "",
    });
    if(!res.ok) throw new Error(`HTTP ${res.status} (${res.method} ${res.url})`);
    let data = await res.text();
    let csrfTokenMatch = data.match(/^ZOOM-CSRFTOKEN:([0-9A-Za-z_-]+)$/);
    if(!csrfTokenMatch) throw new Error("Couldn't get CSRF token");
    csrfToken = csrfTokenMatch[1];
  }

  let body = new URLSearchParams();
  body.append("topic", topic);
  body.append("agenda", description);
  body.append("timezone", timezone);
  body.append("start_date", startDate);
  body.append("start_time", startTime);
  body.append("start_time_2", startAMPM);
  body.append("duration", duration);
  if(duration === 0 || !when) {
    body.append("option_rm", true);
    body.append("recurrence_setting", JSON.stringify({
      "type": "CLASSIC",
      "timezone": timezone,
    }));
  } else {
    body.append("option_rm", false);
  }
  body.append("option_jbh", allowJoinBeforeHost);
  body.append("option_video_host", hostVideo ? "on" : "off");
  body.append("option_video_participants", participantVideo ? "on" : "off");
  body.append("option_audio_type", audioType);
  body.append("password", password);
  body.append("mtg_alternative_host", altHosts ? altHosts.join(",") : "");
  body.append("enable_alternative_host_edit_poll", allowAltHostToEditPoll);
  body.append("option_pac", enablePAC);
  body.append("option_waiting_room", enableWaitingRoom ? "1" : "0");
  if(dialInOptions) body.append("global_dialin_countries", JSON.stringify(dialInOptions));
  if(authOptions) body.append("authOptionsJson", JSON.stringify(authOptions));
  body.append("option_enforce_signed_in", enforceSignInMode);
  body.append("option_bre_room", !!breakoutRoomOptions);
  if(breakoutRoomOptions) body.append("breout_room_info", JSON.stringify(breakoutRoomOptions));
  body.append("autorec", autoRecordMode);
  body.append("option_registration", requireRegistration);
  body.append("with_pmi", usePersonalMeetingID);
  body.append("option_mute_upon_entry", enableMuteUponEntry ? "1" : "0");
  body.append("jbhPriorStartMeeting", allowJoinBeforeHostBeforeMeeting ? "1" : "0");
  body.append("enable_join_meeting_region", !!((regionAllowList && regionAllowList.length) || (regionDenyList && regionDenyList.length)));
  if(regionAllowList) body.append("white_region_list", JSON.stringify(regionAllowList));
  if(regionDenyList) body.append("black_region_list", JSON.stringify(regionDenyList));
  let res = await fetch(`${zoomOrigin}/meeting/save`, {
    method: "POST",
    headers: {
      ...baseHeaders,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest, XMLHttpRequest, OWASP CSRFGuard Project",
      "ZOOM-CSRFTOKEN": csrfToken,
    },
    body: body.toString(),
  });
  if(!res.ok) throw new Error(`HTTP ${res.status} (${res.method} ${res.url})`);
  let data = await res.json();
  if(!data.status || data.errorCode !== 0 || data.errorMessage) {
    if(data.errorCode === 201) throw new Error(`Session expired, log in and update your cookies`);
    throw new Error(`Error creating meeting: ${data.errorMessage} (code: ${data.errorCode})`);
  }
  let meetingID = data.result;

  res = await fetch(`${zoomOrigin}/meeting/${meetingID}`, {
    headers: baseHeaders,
  });
  if(!res.ok) throw new Error(`HTTP ${res.status} (${res.method} ${res.url})`);
  data = await res.text();
  let meetingLinkMatch = data.match(new RegExp(`href="(${zoomOrigin}/j/${meetingID}[^"]*)"`));
  if(!meetingLinkMatch) throw new Error("Could not find meeting link on meeting page");
  let meetingLink = meetingLinkMatch[1];
  return {
    id: meetingID,
    link: meetingLink,
  };
}
