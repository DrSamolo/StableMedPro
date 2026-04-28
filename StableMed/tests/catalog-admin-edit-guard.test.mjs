import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CATALOG_PAGE_PATH = new URL("../components/catalog/catalog-page.tsx", import.meta.url);
const catalogPageSource = readFileSync(CATALOG_PAGE_PATH, "utf8");

test("catalog fiche technique edit action is gated to admin role", () => {
  assert.match(
    catalogPageSource,
    /const normalizedRole = \(profile\?\.role \?\? ''\)\.trim\(\)\.toLowerCase\(\)/m,
  );
  assert.match(catalogPageSource, /const isAdmin = normalizedRole === 'admin';/m);

  assert.match(
    catalogPageSource,
    /\{isAdmin \? \([\s\S]*?Modifier la fiche[\s\S]*?\) : null\}/m,
  );

  assert.match(
    catalogPageSource,
    /const handleOpenEditTraining = \(\) => \{[\s\S]*?if \(!isAdmin \|\| !selectedTraining\)[\s\S]*?Accès réservé aux administrateurs\./m,
  );

  assert.match(
    catalogPageSource,
    /const handleSaveTrainingEdits = async \(\) => \{[\s\S]*?if \(!isAdmin \|\| !selectedTraining\)[\s\S]*?Accès réservé aux administrateurs\./m,
  );
});
