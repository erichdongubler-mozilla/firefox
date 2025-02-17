/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
pub use getrandom::*;

pub fn getrandom(dest: &mut [u8]) -> Result<(), Error> {
    getrandom::fill(dest)
}

pub fn getrandom_uninit(dest: &mut [std::mem::MaybeUninit<u8>]) -> Result<&mut [u8], Error> {
    getrandom::fill_uninit(dest)
}
