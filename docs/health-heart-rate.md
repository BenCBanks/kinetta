# Heart rate from Apple Health

Kinetta estimates average heart rate from the readings it receives. A Garmin workout in Apple Health may not contain
the complete heart-rate recording or Garmin's original workout average. Garmin documents that its Health export
includes all-day heart rate and only high/low values from timed activities. A correct estimate from Health samples
therefore may still differ from the original FIT recording's average.

## How the average is calculated

Average heart rate uses time between valid readings, independently of GPS movement detection. For each pair of
successive positive, finite readings, Kinetta averages the two values and weights that midpoint by the elapsed time.
Intervals longer than five minutes, duplicate/backwards timestamps and missing/nonpositive readings contribute no
unobserved time. No value is extrapolated before the first or after the last usable observation. Heart-rate zones
and effort use the same observed intervals. A recording with no usable interval has no estimated average, zones or
effort; summary-only manual/device totals retain their existing handling.

This fixes sparse Health imports being reduced to one incidental short interval because their normal reading cadence
exceeded the 30-second GPS/movement cutoff. The movement cutoff, distance, pace and GPS handling are not widened.
These are estimates of the available recording, not a reconstruction of missing sensor measurements or Garmin's
proprietary summary.

## Existing imports

A Health replay can recalculate an unchanged recording's old HR summary when the value still matches its previously
imported baseline. It preserves user corrections, custom titles, original samples, duration and summaries from another
source. The matching automatic HR zones/effort refresh with a corrected imported average. A record without a trusted
baseline needs an explicit, backed-up correction rather than an unrestricted overwrite.

For full Garmin detail, an original FIT recording or another source that supplies it is needed; it cannot be recovered
from values that were never exported to Health. See [Garmin's export description](https://support.garmin.com/en-US/?faq=lK5FPB9iPF5PXFkIpFlFPA).
