#!/bin/bash
# Fetches the custom fine-tuned Tesseract model from the restricted
# TESSERACT_TRAINING R2 bucket into the container's build context,
# so the Dockerfile's COPY step has something to copy.
#
# Bootstrap fallback: if no custom model has been trained yet (R2 object
# not found), copies the stock English tessdata file instead, under the
# custom "rmpg" language code. This means the container always builds,
# even before fine-tuning has happened — the OCR just won't be any
# better than stock Tesseract until a real model is uploaded and this
# script picks it up on the next deploy.
set -euo pipefail

DEST_DIR="containers/tesseract-ocr/model"
DEST_FILE="$DEST_DIR/rmpg.traineddata"
R2_KEY="rmpg-flex-tesseract-training/models/latest/tesseract.traineddata"

mkdir -p "$DEST_DIR"

if npx wrangler r2 object get "$R2_KEY" --file="$DEST_FILE" --remote 2>/dev/null; then
  echo "Fetched custom fine-tuned model from R2."
else
  echo "No custom model found in R2 yet — falling back to stock English tessdata."
  # Stock eng.traineddata ships with the tesseract-ocr-eng apt package,
  # which isn't installed on the GitHub Actions runner itself — download
  # the same well-known stock file tesseract-ocr-eng installs, from the
  # official tessdata repo, so a fresh checkout with no trained model yet
  # still produces a working (stock-accuracy) container.
  curl -sSL -o "$DEST_FILE" \
    "https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/eng.traineddata"
fi

ls -la "$DEST_FILE"
