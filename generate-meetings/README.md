# Meeting Generation

Batch-generate Zoom meetings (e.g. for remote exams). Inspired [by CS162](https://github.com/Berkeley-CS162/zoom-automation/tree/main/meeting-generation), but without Selenium BS.

## Dependencies

- [Node.js](https://nodejs.org) >= 12

Run `npm install` to install dependencies.

## Usage

- `cd` to this folder
- Go to [https://berkeley.zoom.us](https://berkeley.zoom.us), log in, and export your
cookies to `cookies.txt` in Netscape format
  - There are extensions to make this easier: ["cookies.txt" for Firefox](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/), ["Get cookies.txt" for Chrome](https://chrome.google.com/webstore/detail/get-cookiestxt/bgaddhkoddajcdgocldbbfleckgcbcid)
  - Note that Zoom auth tokens are rather short-lived
- Create a CSV (default: `roster.csv`). Columns:
  - `Email` (required): emails to generate meetings for
  - `Topic` (optional): overrides `--topic` for this meeting only
  - `Description` (optional): overrides `--description` for this meeting only
  - `When` (optional): overrides `--when` for this meeting only
  - `Duration` (optional): overrides `--duration` for this meeting only
  - `Timezone` (optional): overrides `--timezone` for this meeting only
- Run `node generate` with any desired arguments. An output CSV will be created, with `Email` and `Meeting` columns. Entries will be appended if the file already exists
  - A row will have `Meeting`: `ERROR` if meeting generation failed for that user

```
Options:
      --help         Show help                                         [boolean]
  -i, --input        Input CSV (requires column: Email)  [default: "roster.csv"]
  -o, --output       Output CSV (creates columns: Email, Meeting) ('stdout' for
                     stdout)                           [default: "meetings.csv"]
      --cookies      Netscape cookies.txt file          [default: "cookies.txt"]
  -t, --topic        Name of meeting (@ for email)      [default: "Meeting (@)"]
      --description  Description of meeting (@ for email)
  -w, --when         Date/time of meeting, as ISO timestamp      [default: null]
  -d, --duration     Duration of meeting, in minutes (multiple of 15). If 0,
                     meeting will not have a set date/time [number] [default: 0]
      --timezone     Timezone of meeting              [default: system timezone]
  -c, --cohost       Add emails as co-hosts                            [boolean]
      --audioType    Allowed audio types for meeting
                        [choices: "telephony", "voip", "both"] [default: "both"]
      --authMode     Auth enforcement mode for meeting
                  [choices: "zoom-user", "berkeley-user"] [default: "zoom-user"]
      --recordMode   Automatic recording mode for meeting
                          [choices: "none", "local", "cloud"] [default: "cloud"]
      --interval     Interval (ms) between requests              [default: 2000]
```

### Notes

- `when` should be an ISO timezone-aware timestamp (e.g. `2021-09-28T03:00:00-07:00`)
- If `duration` is `0`, `when` is ignored and the meeting does not have a set start/end time
- Zoom only accepts certain `duration`s (it seems to be multiples of 15)
- Running concurrent instances with the same output CSV is not supported

### Example

```sh
node generate -o links.csv -t "[CS 61C] Midterm 8: @" -w 2021-09-28T03:00:00-07:00 -d 60 -c
```

## Bonus Usage: Un-generate (delete) meetings

You can bulk-delete meetings with `ungenerate.js`. It takes an input CSV with a `Meeting` column (e.g. the output CSV from `generate.js`).

```sh
node ungenerate -i links.csv
```

## Recommendations

Zoom settings (account-wide): [https://berkeley.zoom.us/profile/setting](https://berkeley.zoom.us/profile/setting)

- May want to turn off meeting enter/exit notification sounds ("Sound notification when someone joins or leaves")
- May want to turn off various (email) notifications:
  - "When a cloud recording is available"
  - "When attendees join meeting before host"
  - "When a meeting is cancelled"
  - "When an alternative host is set or removed from a meeting"
  - "When someone scheduled a meeting for a host"
  - "When the cloud recording is going to be permanently deleted from trash"

## Known Issues

- Some users see the message "you have a meeting that is currently in progress"; it is safe to click "end other meeting" and join anyway
  - However, the account used to generate meetings should not be used during those meetings
- Some users do not have Zoom Education accounts provisioned (usually concurrent enrollment students); we usually handle these cases separately
