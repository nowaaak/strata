use serde::Serialize;
use ts_rs::TS;

const DEV_SUFFIX: &str = ".dev";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Channel {
    Dev,
    Release,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub version: String,
    pub channel: Channel,
}

pub fn current() -> Channel {
    if cfg!(debug_assertions) {
        Channel::Dev
    } else {
        Channel::Release
    }
}

pub fn check_identity(identifier: &str, channel: Channel) -> Result<(), String> {
    if channel == Channel::Dev && !identifier.ends_with(DEV_SUFFIX) {
        return Err(format!(
            "this development build uses the release identifier {identifier} and would change the data of the installed Strata. Start it with `npm run app` instead of `npm run tauri dev`."
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_builds_need_a_dev_identity() {
        assert!(check_identity("nd.strata", Channel::Dev).is_err());
        assert!(check_identity("nd.strata.dev", Channel::Dev).is_ok());
        assert!(check_identity("nd.strata", Channel::Release).is_ok());
    }
}
