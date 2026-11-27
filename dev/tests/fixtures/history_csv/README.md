# Fictional history CSV probes

Every value and workout/food name is fictional. `generic-daily.csv` follows Kinetta’s documented Add past days columns (app/static/food-import.js). **All nine vendor-labelled layouts are UNVERIFIED hypotheses**, not vendor exports or compatibility claims. Their names describe the scenario being tested. No official page retrieved publishes these exact header rows; do not remove the unverified labels without a vendor-produced, safely fictional sample or published schema.

Official evidence, checked 27 November 2026:

- MyFitnessPal: https://support.myfitnesspal.com/hc/en-us/articles/360032273352-Export-your-nutrition-progress-and-exercise-data — Premium/Premium+, ZIP containing meal nutrition, progress and exercise CSVs; no exact headers.
- Cronometer: https://support.cronometer.com/hc/en-us/articles/360018760151-Account-Settings — CSV exports, Daily Nutrition with optional diary group rows, and separate biometrics. Turn group rows off to avoid subtotal/day-total overlap. No exact headers.
- MacroFactor: https://help.macrofactorapp.com/en/articles/68-export-your-data — Quick/Granular spreadsheets, including scale/trend weight, expenditure, intake and targets. Exact headers/file type not established by this page.
- Lose It: https://help.loseit.com/en/articles/10134940-exporting-data — blocked (403); format and columns remain unverified.
- Strong: https://help.strongapp.io/article/235-export-workout-data — Settings → Export Strong Data (iOS) / Export Data (Android); CSV, no headers.
- Hevy: https://help.hevyapp.com/hc/en-us/articles/43708290987415-Exporting-Your-Data-from-Hevy — Profile → Settings → Export & Import Data → Export Data → workouts/measurements. Spreadsheet/CSV, no headers.
- Hevy’s Strong import guide: https://help.hevyapp.com/hc/en-us/articles/35687878672663-Importing-Strong-Data-into-Hevy — direct English Strong export; their support supplies its sample on request. This does not verify an assumed Strong schema.

The tests establish conservative behavior for these shapes only: repeat saves replace an imported day, app-logged food wins, accounts remain isolated, and lifting loads and overlapping totals are rejected; separate meal groups still sum. They do not reconstruct meals or exercise sets. Kinetta accepts pasted CSV text here, not ZIP/XLSX containers.
