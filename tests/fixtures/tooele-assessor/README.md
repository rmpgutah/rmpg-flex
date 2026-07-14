# Tooele County Recorder fixtures

Tooele County's given URL (`property_records_search.php`) only links out to
a Tyler/Eagle Software e-recording document index — there is no separate
assessor valuation site. These synthetic fixtures match that document-index
page's structure: owner/grantee name, parcel/document cross-reference,
and a link to the recorded document image. No assessed value, year built,
or land square footage fields exist at this source — `parser.ts`
deliberately leaves those fields null rather than guessing.
