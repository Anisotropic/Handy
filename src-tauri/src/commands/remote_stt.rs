use crate::commands::models;
use crate::managers::model::ModelManager;
use crate::settings::get_settings;
use log::info;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// Health check response from the remote STT server's /health endpoint.
#[derive(Debug, Clone, Deserialize, Type)]
pub struct RemoteHealth {
    pub status: Option<String>,
    pub ready: Option<bool>,
    pub models: Option<Vec<String>>,
    pub loaded: Option<Vec<String>>,
    pub default_model: Option<String>,
}

/// Health check result returned to the frontend.
#[derive(Debug, Clone, Serialize, Type)]
pub struct RemoteSttConnectionResult {
    pub ok: bool,
    pub health: RemoteSttHealthInfo,
}

/// Parsed health info from the remote server.
#[derive(Debug, Clone, Serialize, Type)]
pub struct RemoteSttHealthInfo {
    pub status: Option<String>,
    pub ready: Option<bool>,
    pub models: Option<Vec<String>>,
    pub loaded: Option<Vec<String>>,
    pub default_model: Option<String>,
    pub error: Option<String>,
}

/// Check if the remote STT server is reachable and healthy.
///
/// From `base_url` (e.g. "http://host:5092/v1"), strips the last path
/// segment to get the health URL: "http://host:5092/health".
///
/// If /health returns 404 (non-OpenAI-compatible server), falls back to
/// reporting "server responds" without health details.
#[tauri::command]
#[specta::specta]
pub fn test_remote_stt_connection(
    app_handle: AppHandle,
) -> Result<RemoteSttConnectionResult, String> {
    let settings = get_settings(&app_handle);
    let base_url = settings.remote_stt.base_url.clone();

    // Strip trailing slash and last path segment to get health URL
    let base_url = base_url.trim_end_matches('/');
    let health_url = match base_url.rfind('/') {
        Some(idx) => {
            let mut url = base_url.to_string();
            url.truncate(idx);
            format!("{}/health", url)
        }
        None => format!("{}/health", base_url),
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let response = client.get(&health_url).send().map_err(|e| e.to_string())?;

    if response.status().is_success() {
        match response.json::<RemoteHealth>() {
            Ok(health) => Ok(RemoteSttConnectionResult {
                ok: true,
                health: RemoteSttHealthInfo {
                    status: health.status,
                    ready: health.ready,
                    models: health.models,
                    loaded: health.loaded,
                    default_model: health.default_model,
                    error: None,
                },
            }),
            Err(e) => {
                // JSON parse failed but endpoint responded — server has /health but different shape
                Ok(RemoteSttConnectionResult {
                    ok: true,
                    health: RemoteSttHealthInfo {
                        status: Some("ok (unknown shape)".to_string()),
                        ready: None,
                        models: None,
                        loaded: None,
                        default_model: None,
                        error: Some(format!(
                            "Server responded to /health but response is not in expected format: {}",
                            e
                        )),
                    },
                })
            }
        }
    } else {
        Ok(RemoteSttConnectionResult {
            ok: false,
            health: RemoteSttHealthInfo {
                status: Some(format!("HTTP {}", response.status())),
                ready: None,
                models: None,
                loaded: None,
                default_model: None,
                error: None,
            },
        })
    }
}

/// Update the remote STT base URL setting.
#[tauri::command]
#[specta::specta]
pub fn change_remote_stt_base_url(app_handle: AppHandle, base_url: String) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app_handle);
    settings.remote_stt.base_url = base_url;
    crate::settings::write_settings(&app_handle, settings);
    Ok(())
}

/// Update the remote STT API key setting.
#[tauri::command]
#[specta::specta]
pub fn change_remote_stt_api_key(app_handle: AppHandle, api_key: String) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app_handle);
    settings
        .remote_stt
        .api_keys
        .insert("remote_stt".to_string(), api_key);
    crate::settings::write_settings(&app_handle, settings);
    Ok(())
}

/// Update the remote STT model name setting.
#[tauri::command]
#[specta::specta]
pub fn change_remote_stt_model(app_handle: AppHandle, model: String) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app_handle);
    settings.remote_stt.model = model;
    crate::settings::write_settings(&app_handle, settings);
    Ok(())
}

/// Update the remote STT display name setting and sync the model registry.
#[tauri::command]
#[specta::specta]
pub fn change_remote_stt_name(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    name: String,
) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app_handle);
    settings.remote_stt.name = name;
    crate::settings::write_settings(&app_handle, settings.clone());

    // Sync the registry so the dropdown shows the updated name immediately.
    model_manager.sync_remote_model(&settings);
    let _ = app_handle.emit("models-updated", ());
    Ok(())
}

/// Enable the remote STT model, select it as the active model, and mark
/// onboarding as complete. Used by the onboarding "Remote transcribe model"
/// button.
#[tauri::command]
#[specta::specta]
pub async fn select_remote_stt_model(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
) -> Result<(), String> {
    let mut settings = get_settings(&app_handle);
    settings.remote_stt.enabled = true;
    crate::settings::write_settings(&app_handle, settings.clone());

    // Put the model into the registry so switch_active_model can find it.
    model_manager.sync_remote_model(&settings);

    // Reuse the shared switch logic: persists selected_model, sets
    // onboarding_completed, clears any stale local engine and emits
    // model-state-changed (which makes modelStore reload).
    models::switch_active_model(&app_handle, crate::managers::model::REMOTE_STT_MODEL_ID)?;

    let _ = app_handle.emit("models-updated", ());
    Ok(())
}

/// Toggle remote STT model visibility in the model list.
///
/// When disabling, also clears the selection if the remote model was active
/// (so the next transcription doesn't hit "Model not found").
#[tauri::command]
#[specta::specta]
pub fn change_remote_stt_enabled(
    app_handle: AppHandle,
    model_manager: State<'_, Arc<ModelManager>>,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = crate::settings::get_settings(&app_handle);
    settings.remote_stt.enabled = enabled;

    // If disabling and the remote model is currently selected, clear the selection
    // so the next transcription doesn't try to use a model that's no longer in the registry.
    if !enabled && settings.selected_model == crate::managers::model::REMOTE_STT_MODEL_ID {
        info!("Remote STT disabled while selected — clearing selection");
        settings.selected_model = String::new();
    }

    crate::settings::write_settings(&app_handle, settings.clone());

    // Sync the registry — insert or remove the remote model entry.
    model_manager.sync_remote_model(&settings);
    let _ = app_handle.emit("models-updated", ());
    Ok(())
}
