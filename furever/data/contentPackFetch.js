// contentPackFetch.js — Google Drive API key for Furever's future "fetch the
// breeder's published content pack" flow (see
// docs/KennelOS_Content_Package_Fetch_Mechanism.md § 5, in the KennelOS repo).
// API_KEY below is a public Google Cloud API key for the same "KennelOS"
// project as shared/data/googleDrive.js's CLIENT_ID, restricted two ways at
// https://console.cloud.google.com:
//   - Application restriction: HTTP referrers limited to the Furever origin
//     (https://furever.kennelos.app/*) plus http://localhost:8000/* for dev;
//   - API restriction: Google Drive API only.
// Those restrictions are the actual control, not secrecy — this key can only
// ever read files the breeder has already made public-by-link, and only when
// called from an allowed origin.
//
// The fetch flow itself (reading the manifest + files by id) is not built
// yet — this file exists so the credential has one canonical home per
// docs/…Fetch_Mechanism.md § 5.2.
export const API_KEY = 'AIzaSyBvoty8PqxHv6KaZ3le_H0LNHYW9KhpZIk';
