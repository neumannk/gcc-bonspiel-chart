# GCC Bonspiel Team Page

A [Tampermonkey](https://www.tampermonkey.net/) userscript that adds a cleaner team view to team pages on the [Granite Curling Club of Seattle](https://curlingseattle.org) bonspiel site.

It never replaces or hides the original page. The new view is added below the existing "Team Information" block.

## What it adds

- **Status line**: "In the A bracket", "In RR play", "Out", "Won the A bracket", and so on.
- **Games table** with results and scores.
- **Next game** card, with the opponent linked to their team page.
- **Road graph**: the team's played games, plus every road still possible from their next game. Tap a node to highlight the path to it.
- A collapsible "every road, line by line" list.

It works for any event that has a schedule table. If the event has no schedule, the script does nothing.

## Install

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/).
2. Open the raw script and let the manager install it:
   [gcc-bonspiel-team-view.user.js](https://raw.githubusercontent.com/neumannk/gcc-bonspiel-chart/main/gcc-bonspiel-team-view.user.js)
3. Visit any team page, for example
   `https://curlingseattle.org/bonspiels?event=2026Holiday&disp=team&teamid=3`.

## How it works

The script runs only on `curlingseattle.org` pages with `disp=team`, `event`, and `teamid` in the URL. It then:

1. Reads the team name and game results already printed on the team page. Those results take priority over everything else.
2. Fetches the event's schedule (`disp=table`) and parses every game and its `W:`/`L:` advancement targets.
3. Fetches the line-score pages for the team's games to fill in scores.
4. Renders the panel and the road graph after the original content.

Everything happens in your browser. Nothing is sent anywhere except requests to curlingseattle.org itself.

## Made with AI

This project was created entirely with AI. Expect rough edges, and check anything important against the official schedule.

## Not affiliated

This is an unofficial tool and is not affiliated with or endorsed by the Granite Curling Club.

## License

[0BSD](LICENSE). Do whatever you like with it, no attribution required. There is no warranty of any kind.
