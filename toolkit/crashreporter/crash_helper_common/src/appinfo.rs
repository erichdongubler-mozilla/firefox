/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

use std::{
    env, fs, io,
    path::PathBuf,
    time::{SystemTimeError, UNIX_EPOCH},
};

use thiserror::Error;

#[cfg(not(target_os = "windows"))]
pub(crate) mod unix;

#[cfg(target_os = "windows")]
pub(crate) mod windows;

/*****************************************************************************
 * Error definitions                                                         *
 *****************************************************************************/

#[derive(Debug, Error)]
pub enum AppInfoError {
    #[error("Could not access the installation time information")]
    InstallationTimeAccess(#[from] io::Error),
    #[error("Could not calculate the installation time")]
    MissingInstallationTime(#[from] SystemTimeError),
}

/****************************************************************************
 * Application information                                                   *
 *****************************************************************************/

pub struct ApplicationInfo {
    build_id: String,
    install_time: u64,
}

impl ApplicationInfo {
    pub fn new(build_id: String, install_time: Option<u64>) -> ApplicationInfo {
        ApplicationInfo {
            build_id,
            install_time: install_time
                .unwrap_or_else(|| Self::compute_install_time(None).unwrap_or(0)),
        }
    }

    pub fn get_app_id(&self) -> &str {
        mozbuild::config::MOZ_APP_ID
    }

    pub fn get_app_name(&self) -> &str {
        mozbuild::config::MOZ_APP_BASENAME
    }

    pub fn get_buildid(&self) -> &str {
        &self.build_id
    }

    pub fn get_install_time(&self) -> u64 {
        self.install_time
    }

    pub fn compute_install_time(path: Option<PathBuf>) -> Result<u64, AppInfoError> {
        let exe_path = path.unwrap_or(env::current_exe()?);
        let metadata = fs::metadata(exe_path)?;
        let mod_time = metadata.modified()?;
        let install_time = mod_time.duration_since(UNIX_EPOCH)?;

        Ok(install_time
            .as_secs()
            .saturating_sub(Self::get_user_id().unwrap_or(0)))
    }

    pub fn get_release_channel(&self) -> &'static str {
        mozbuild::config::MOZ_UPDATE_CHANNEL
    }

    pub fn get_server_url(&self) -> String {
        format!(
            "{}/submit?id={}&version={}&buildid={}",
            mozbuild::config::MOZ_CRASHREPORTER_URL,
            mozbuild::config::MOZ_APP_ID,
            mozbuild::config::MOZ_APP_VERSION,
            self.get_buildid()
        )
    }

    pub fn get_vendor(&self) -> &'static str {
        mozbuild::config::MOZ_APP_VENDOR
    }

    pub fn get_version(&self) -> &'static str {
        mozbuild::config::MOZ_APP_VERSION
    }
}
