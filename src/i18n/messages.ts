import * as app from "./modules/app";
import * as common from "./modules/common";
import * as connections from "./modules/connections";
import * as errors from "./modules/errors";
import * as grid from "./modules/grid";
import * as history from "./modules/history";
import * as palette from "./modules/palette";
import * as query from "./modules/query";
import * as schema from "./modules/schema";
import * as settings from "./modules/settings";
import * as structure from "./modules/structure";
import * as table from "./modules/table";

const de = {
    app: app.de,
    common: common.de,
    connections: connections.de,
    errors: errors.de,
    grid: grid.de,
    history: history.de,
    palette: palette.de,
    query: query.de,
    schema: schema.de,
    settings: settings.de,
    structure: structure.de,
    table: table.de,
};

export type Messages = typeof de;

const en: Messages = {
    app: app.en,
    common: common.en,
    connections: connections.en,
    errors: errors.en,
    grid: grid.en,
    history: history.en,
    palette: palette.en,
    query: query.en,
    schema: schema.en,
    settings: settings.en,
    structure: structure.en,
    table: table.en,
};

export const messages = { de, en } as const;

export type Locale = keyof typeof messages;
