"use strict";

const fs = require("fs");

const util = require("./util");

const AUTH_MODES = ["zoom-user", "berkeley-user"];

async function run() {
  let options = util.cli()
    .option("input", {alias: "i", default: "roster.csv", describe: "Input CSV (requires column: Email)"})
    .option("output", {alias: "o", default: "meetings.csv", describe: "Output CSV (creates columns: Email, Meeting) ('stdout' for stdout)"})
    .option("cookies", {default: "cookies.txt", describe: "Netscape cookies.txt file"})
    .option("topic", {alias: "t", default: "Meeting (@)", describe: "Name of meeting (@ for email)"})
    .option("description", {describe: "Description of meeting (@ for email)"})
    .option("when", {alias: "w", default: null, describe: "Date/time of meeting, as ISO timestamp"})
    .option("duration", {alias: "d", number: true, default: 0, describe: "Duration of meeting, in minutes (multiple of 15). If 0, meeting will not have a set date/time"})
    .option("timeZone", {default: Intl.DateTimeFormat().resolvedOptions().timeZone, describe: "Timezone of meeting"}) // TODO custom help text
    .option("cohost", {alias: "c", boolean: true, describe: "Add emails as co-hosts"})
    .option("audioType", {default: "both", choices: ["telephony", "voip", "both"], describe: "Allowed audio types for meeting"})
    .option("authMode", {default: "zoom-user", choices: AUTH_MODES, describe: "Auth enforcement mode for meeting"})
    .option("recordMode", {default: "cloud", choices: ["none", "local", "cloud"], describe: "Automatic recording mode for meeting"})
    .option("interval", {default: 2000, describe: "Interval (ms) between requests"})
    .option("csrfToken", {hidden: true})
    .strict()
    .version(false)
    .argv;

  options.cookieString = util.getCookieString(options.cookies);

  let input = null;
  try {
    input = await util.readInputCSV(options.input, (row, i) => {
      if(!row.email) throw new Error(`Invalid email found (row: ${i}, email: ${JSON.stringify(row.email)})`);
      if(row.duration) row.duration = +row.duration;
      if(row.cohost) row.cohost = row.cohost.toLowerCase() === "true";
      if(row.authMode) row.authMode = +row.authMode;
    });
  } catch(err) {
    console.error(`[generate] couldn't parse ${options.input}: ${err.stack}`)
    return;
  }

  let outStream = process.stdout;
  let outputEmails = null;
  let isOutputStdout = true;
  if(options.output && options.output !== "stdout") {
    isOutputStdout = false;
    try {
      await fs.promises.access(options.output);
      let output = await util.readInputCSV(options.output);
      outputEmails = new Set(output.map((row) => row.email).filter((email) => email));
      outStream = fs.createWriteStream(options.output, {flags: "a"});
    } catch(err) {
      if(err.code !== "ENOENT") throw err;
      outStream = fs.createWriteStream(options.output, {flags: "a"});
    }
  }
  if(outputEmails) {
    console.error("[generate] appending to existing output file");
  } else {
    if(!isOutputStdout) console.error("[generate] creating new output file");
    outStream.write("Email,Meeting\n");
  }

  for(let i = 0; i < input.length; i++) {
    let row = input[i];
    let email = row.email;
    if(outputEmails && outputEmails.has(email)) {
      console.error(`[${email}] found in output, skipping...`);
      continue;
    }
    try {
      let meetingOptions = {
        ...options,
        ...row,
        altHosts: options.cohost ? [email] : [],
      };
      if(meetingOptions.topic) meetingOptions.topic = meetingOptions.topic.replace("@", email);
      if(meetingOptions.description) meetingOptions.description = meetingOptions.description.replace("@", email);
      if(meetingOptions.authMode) {
        meetingOptions.enforceAuthMode = AUTH_MODES.indexOf(meetingOptions.authMode);
        if(meetingOptions.enforceAuthMode === -1) throw new Error(`Unknown auth mode: ${meetingOptions.authMode}`);
      }
      if(meetingOptions.recordMode) meetingOptions.autoRecordMode = meetingOptions.recordMode;
      let meeting = await createMeeting(meetingOptions);
      if(!outStream.isTTY) console.error(`[${email}] created meeting (${meeting.link})`);
      outStream.write(`${email},${meeting.link}\n`);
    } catch(err) {
      console.error(`[${email}] failed to create meeting: ${err.stack}`);
      outStream.write(`${email},ERROR\n`);
    }
    if(i < input.length - 1) await util.sleep(options.interval);
  }
}
run().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function createMeeting(options) {
  let {
    topic,
    description,
    when,
    timeZone,
    duration,
    password = Math.floor(Math.random() * 1000000).toString().padStart(6, "0"),
    altHosts = [],
    autoRecordMode = "none",
    audioType = "both",

    allowJoinBeforeHost = true,
    allowJoinBeforeHostBeforeMeeting = true,
    hostVideo = true, // on, off
    participantVideo = true, // on, off
    allowAltHostToEditPoll = false,
    enablePAC = false, // ???
    enableWaitingRoom = false, // 0, 1
    dialInOptions = null,
    authOptions = null,
    enforceAuthMode = 0, // 0 (any Zoom user), 1 (Berkeley Zoom user)
    breakoutRoomOptions = null,
    requireRegistration = false,
    usePersonalMeetingID = false,
    enableMuteUponEntry = false, // 0, 1
    regionAllowList = [],
    regionDenyList = [],
  } = options;

  if(options.enforceAuthMode === 1 && !authOptions) {
    authOptions = {
      "option_enforce_signed_in": options.enforceAuthMode,
      "authDomain": "berkeley.edu,*.berkeley.edu",
      "selectAuthName": "UC Berkeley users only",
    };
  }

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
  let startDate = when.toLocaleDateString("en-US", {timeZone: options.timeZone});
  let [startTime, startAMPM] = when.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "numeric",
    timeZone: options.timeZone,
  }).split(" ");

  let body = new URLSearchParams();
  body.append("topic", topic);
  if(description) body.append("agenda", description);
  body.append("timezone", timeZone);
  body.append("start_date", startDate);
  body.append("start_time", startTime);
  body.append("start_time_2", startAMPM);
  body.append("duration", duration);
  if(duration === 0 || !when) {
    body.append("option_rm", true);
    body.append("recurrence_setting", JSON.stringify({
      "type": "CLASSIC",
      "timezone": timeZone,
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
  body.append("option_enforce_signed_in", enforceAuthMode);
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
  let res = await util.request("/meeting/save", options, {
    zoom: options,
    csrfToken: options.csrfToken || true,
    body: body.toString(),
  });
  let data = await util.getJSON(res);
  let meetingID = data.result;

  res = await util.request(`/meeting/${meetingID}`, options);
  data = await res.text();
  let meetingLinkMatch = data.match(new RegExp(`(?:href="|>)(https?:[^"<]+?/j/${meetingID}[^"<]*)(?:"|<)`));
  if(!meetingLinkMatch) throw new Error("Could not find meeting link on meeting page");
  let meetingLink = meetingLinkMatch[1];
  return {
    id: meetingID,
    link: meetingLink,
  };
}
