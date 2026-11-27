import * as app from "./modules/app";
import * as common from "./modules/common";
import * as connections from "./modules/connections";
import * as designer from "./modules/designer";
import * as dump from "./modules/dump";
import * as errors from "./modules/errors";
import * as explain from "./modules/explain";
import * as grid from "./modules/grid";
import * as history from "./modules/history";
import * as importer from "./modules/importer";
import * as palette from "./modules/palette";
import * as processes from "./modules/processes";
import * as server from "./modules/server";
import * as er from "./modules/er";
import * as users from "./modules/users";
import * as query from "./modules/query";
import * as schema from "./modules/schema";
import * as settings from "./modules/settings";
import * as snippets from "./modules/snippets";
import * as structure from "./modules/structure";
import * as table from "./modules/table";
import * as updater from "./modules/updater";

const de = {
    app: app.de,
    common: common.de,
    connections: connections.de,
    designer: designer.de,
    dump: dump.de,
    errors: errors.de,
    explain: explain.de,
    grid: grid.de,
    history: history.de,
    importer: importer.de,
    palette: palette.de,
    processes: processes.de,
    server: server.de,
    er: er.de,
    users: users.de,
    query: query.de,
    schema: schema.de,
    settings: settings.de,
    snippets: snippets.de,
    structure: structure.de,
    table: table.de,
    updater: updater.de,
};

export type Messages = typeof de;

const en: Messages = {
    app: app.en,
    common: common.en,
    connections: connections.en,
    designer: designer.en,
    dump: dump.en,
    errors: errors.en,
    explain: explain.en,
    grid: grid.en,
    history: history.en,
    importer: importer.en,
    palette: palette.en,
    processes: processes.en,
    server: server.en,
    er: er.en,
    users: users.en,
    query: query.en,
    schema: schema.en,
    settings: settings.en,
    snippets: snippets.en,
    structure: structure.en,
    table: table.en,
    updater: updater.en,
};

export const messages = { de, en } as const;

export type Locale = keyof typeof messages;
