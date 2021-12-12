"use strict";

const fs = require("fs");

const util = require("./util");

async function run() {
  let options = util.cli()
    .option("output", {alias: "o", default: "recordings.csv", describe: "Output CSV (creates columns: Email, Meeting) ('stdout' for stdout)"})
    .option("cookies", {default: "cookies.txt", describe: "Netscape cookies.txt file"})
    .option("password", {default: "", describe: "Password to set for each recording link"})
    .option("interval", {default: 2000, describe: "Interval (ms) between requests"})
    .option("csrfToken", {hidden: true})
    .strict()
    .version(false)
    .argv;

  options.cookieString = util.getCookieString(options.cookies);

  let outStream = process.stdout;
  let outputInternalMeetingIDs = null;
  let isOutputStdout = true;
  if(options.output && options.output !== "stdout") {
    isOutputStdout = false;
    try {
      await fs.promises.access(options.output);
      let output = await util.readInputCSV(options.output);
      outputInternalMeetingIDs = new Set(output.map((row) => row.internalMeetingID).filter((id) => id));
      outStream = fs.createWriteStream(options.output, {flags: "a"});
    } catch(err) {
      if(err.code !== "ENOENT") throw err;
      outStream = fs.createWriteStream(options.output, {flags: "a"});
    }
  }
  if(outputInternalMeetingIDs) {
    console.error("[get-recording-links] appending to existing output file");
  } else {
    if(!isOutputStdout) console.error("[get-recording-links] creating new output file");
    outStream.write("Meeting ID,Timestamp,Internal Meeting ID,Topic,Recording Link\n");
  }

  let recordings = await getRecordingList(options);
  for(let recording of recordings) {
    if(outputInternalMeetingIDs && outputInternalMeetingIDs.has(recording.internalMeetingID)) {
      console.error(`[${recording.internalMeetingID}] found in output, skipping...`);
      continue;
    }
    await util.sleep(options.interval);
    let data = await getRecordingShareInfo({
      ...options,
      recording: recording,
    });
    Object.assign(recording, data);
    outStream.write(`${recording.meetingID},${recording.timestamp},${recording.internalMeetingID},"${recording.topic.replace(/"/g, '""')}",${recording.link}\n`);
  }
}
run().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function getRecordingShareInfo(options) {
  let {
    recording,
  } = options;

  let body = new URLSearchParams();
  body.append("passwd", options.password || "");
  body.append("id", recording.internalMeetingID);
  let res = await util.request("/recording/update_meet_passwd", options, {
    csrfToken: options.csrfToken || true,
    body: body.toString(),
  });
  let data = await util.getJSON(res);

  body = new URLSearchParams();
  body.append("meeting_id", recording.internalMeetingID);
  res = await util.request("/recording/get_recordmeet_shareinfo", options, {
    csrfToken: options.csrfToken || true,
    body: body.toString(),
  });
  data = await util.getJSON(res);
  let result = JSON.parse(data.result);
  console.error(`[get-recording-links] fetched recording share info (topic: ${recording.topic})`);

  let encryptedRecordingID = result.encryptMeetId;

  return {
    link: util.getURL(`/rec/share/${encryptedRecordingID}`).toString(),
  };
}

async function getRecordingList(options) {
  let {
    page = 1,
  } = options;

  let body = new URLSearchParams();
  body.append("from", "");
  body.append("to", "");
  body.append("search_value", "");
  body.append("transcript_keyword", "");
  body.append("search_type", "mixed");
  body.append("p", page);
  body.append("search_status", "0");
  body.append("assistant_host_id", "");
  let res = await util.request("/recording/host_list", options, {
    csrfToken: options.csrfToken || true,
    body: body.toString(),
  });
  let data = await util.getJSON(res);
  let result = data.result;
  let pageNum = result.page;
  let numRecordings = result.total_records;
  let numPages = Math.ceil(numRecordings / result.page_size);
  console.error(`[get-recording-links] fetched recordings (page ${pageNum} / ${numPages})`);

  let recordings = result.recordings.map((recording) => {
    return {
      meetingID: recording.meetingNumber,
      internalMeetingID: recording.meetingId,
      timestamp: new Date(recording.createTime).toISOString(),
      topic: recording.topic,
    };
  });

  if(pageNum < numPages) {
    await util.sleep(options.interval);
    recordings = recordings.concat(await getRecordingList({ ...options, page: pageNum + 1 }));
  }

  return recordings;
}
