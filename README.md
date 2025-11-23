# Badger Budget: Planning Edition

An in-browser budgeting game that simulates a year of financial tradeoffs: paying fixed bills, handling surprise events, growing savings, and balancing quality of life. It is entirely client-side (HTML/CSS/JS); no build step required.

## Quick Start

1) Clone or download the repo.  
2) Open `game.html` in your browser (double-click or drag into a tab).  
3) Choose difficulty and housing, then play by dragging bills to cards or using the “Pay Full” buttons. Finish each round to advance two weeks.

## Game Flow Highlights

- Fixed costs (rent, utilities, car, student loan, insurance) linger for two rounds, allowing partial payments.  
- Variable spend (food, entertainment, etc.) influences Quality of Life (QoL); chronic underfunding lowers QoL.  
- Goals and savings earn interest; emergency fund and insurance mitigate events.  
- Events unlock after the early rounds and include medical surprises, layoffs, bonuses, rent hikes, and seasonal effects.  
- Lose if QoL hits 0 or debt reaches 50% of your annual salary. Win by surviving a year (week 52).

## Controls & Tips

- Drag cash/credit bills onto cards; click mini-bills on a card to undo.  
- “Pay Full” clears a card instantly (credit is blocked on savings and debt-payoff cards).  
- The QoL bar shows 0–100. The debt badge tooltip lists active debt items.  
- The recap modal (“View Recap”) summarizes cause-and-effect each round.

## Files

- `game.html` – layout and UI scaffolding.  
- `game.css` – styling.  
- `game.js` – game logic, events, state management.

## Contributing

- Keep changes ASCII-only unless necessary.  
- Avoid destructive git operations; commit incremental improvements.  
- If adding new cards/events, prefer data-driven hooks in `game.js` and keep amounts consistent with existing balance.
