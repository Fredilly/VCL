# Spike 5 end-to-end manual validation

`cases.json` is the fixed, fresh ten-selection protocol. The rows are deliberately
product-focused YouTube videos and were set before outcome collection. It is not a
benchmark corpus and shares no case with Spike 4f.

Run the dedicated Chrome profile with the built unpacked extension, then collect
the UI result for each frozen row. `results.json` records only derived results:
no video-frame bytes, request bodies, or credentials.

The pass rule is eight or more sessions that are commercially useful or are a
truthful low-confidence/no-result state, with no false `EXACT` or unsupported
`LIKELY` classifications. A row must retain its source, timestamp, and selected
item even when it fails.
