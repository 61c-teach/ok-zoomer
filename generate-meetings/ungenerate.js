"use strict";

const util = require("./util");

async function run() {
  let options = util.cli()
    .option("input", {alias: "i", default: "meetings.csv", describe: "Input CSV (requires columns: Email, Meeting)"})
    .option("cookies", {default: "cookies.txt", describe: "Netscape cookies.txt file"})
    .option("interval", {default: 2000, describe: "Interval (ms) between requests"})
    .option("csrfToken", {hidden: true})
    .strict()
    .version(false)
    .argv;

  options.cookieString = util.getCookieString(options.cookies);

  let input = null;
  try {
    input = await util.readInputCSV(options.input);
  } catch(err) {
    console.error(`[ungenerate] ouldn't parse ${options.input}: ${err.stack}`)
    return;
  }

  for(let i = 0; i < input.length; i++) {
    let row = input[i];
    let rowID = row.email || `row[${i}]`;
    try {
      let meetingOptions = {
        ...options,
        ...row,
      };
      let link = meetingOptions.meeting;
      if(!link || link === "ERROR") continue;
      let linkMatch = link.match(/\/j\/([0-9]+)(?:[^0-9]|$)/);
      if(!linkMatch) throw new Error(`Unknown meeting link: ${link}`);
      meetingOptions.meetingID = linkMatch[1];
      await deleteMeeting(meetingOptions);
      console.error(`[${rowID}] deleted meeting (${link})`);
    } catch(err) {
      console.error(`[${rowID}] failed to delete meeting: ${err.stack}`);
    }
    if(i < input.length - 1) await util.sleep(options.interval);
  }
}
run().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function deleteMeeting(options) {
  let {
    meetingID,
  } = options;

  let body = new URLSearchParams();
  body.append("user_id", "");
  body.append("id", meetingID);
  body.append("occurrence", "");
  body.append("sendMail", false);
  body.append("mailBody", "");
  let res = await util.request("/meeting/delete", options, {
    csrfToken: options.csrfToken || true,
    body: body.toString(),
  });
  let data = await util.getJSON(res);
}
