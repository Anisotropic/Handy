import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commands,
  type RemoteSttConnectionResult,
  type RemoteSttSettings,
} from "@/bindings";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { SettingContainer } from "../ui/SettingContainer";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useSettings } from "../../hooks/useSettings";

// Local mirror of a persisted text setting. Edits update local state
// synchronously so the caret stays where the user put it — a controlled
// input whose value round-trips through the backend on every keystroke
// re-sets the DOM value once the round-trip returns and jumps the caret to
// the end. The value is committed to the backend only on blur, the same
// pattern as ApiKeyField / BaseUrlField in the post-processing settings.
function useLocalText(value: string, commit: (value: string) => void) {
  const [local, setLocal] = useState(value);

  // Re-sync when the persisted value changes from outside (e.g. after we
  // commit a trimmed value, or on a settings refresh).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  return {
    value: local,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setLocal(event.target.value),
    onBlur: () => commit(local),
  };
}

const RemoteSTTSettingsComponent: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateRemoteSttSetting, isUpdating } = useSettings();

  const remoteStt: Partial<RemoteSttSettings> =
    getSetting("remote_stt") ?? {};

  const enabled = remoteStt.enabled ?? false;
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<RemoteSttConnectionResult | null>(null);

  // Current persisted values — the source of truth each blur commit compares
  // against.
  const name = remoteStt.name ?? "";
  const baseUrl = remoteStt.base_url ?? "";
  const model = remoteStt.model ?? "";
  const apiKey = remoteStt.api_keys?.["remote_stt"] ?? "";

  const commitName = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed !== name) {
        void updateRemoteSttSetting("name", trimmed);
      }
    },
    [name, updateRemoteSttSetting],
  );

  const commitBaseUrl = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed !== baseUrl) {
        void updateRemoteSttSetting("base_url", trimmed);
      }
    },
    [baseUrl, updateRemoteSttSetting],
  );

  const commitModel = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed !== model) {
        void updateRemoteSttSetting("model", trimmed);
      }
    },
    [model, updateRemoteSttSetting],
  );

  const commitApiKey = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed !== apiKey) {
        void updateRemoteSttSetting("api_keys", {
          ...remoteStt.api_keys,
          remote_stt: trimmed,
        });
      }
    },
    [apiKey, remoteStt.api_keys, updateRemoteSttSetting],
  );

  const nameField = useLocalText(name, commitName);
  const baseUrlField = useLocalText(baseUrl, commitBaseUrl);
  const modelField = useLocalText(model, commitModel);
  const apiKeyField = useLocalText(apiKey, commitApiKey);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    try {
      const res = await commands.testRemoteSttConnection();
      if (res.status === "ok") {
        setResult(res.data);
      } else {
        setResult({
          ok: false,
          health: {
            status: "error",
            ready: null,
            models: null,
            loaded: null,
            default_model: null,
            error: res.error,
          },
        });
      }
    } catch (e) {
      setResult({
        ok: false,
        health: {
          status: "error",
          ready: null,
          models: null,
          loaded: null,
          default_model: null,
          error: String(e),
        },
      });
    } finally {
      setTesting(false);
    }
  }, []);

  return (
    <div>
      <ToggleSwitch
        checked={enabled}
        onChange={(nextEnabled) =>
          updateRemoteSttSetting("enabled", nextEnabled)
        }
        isUpdating={isUpdating("remote_stt.enabled")}
        label={t("settings.remoteStt.enabled")}
        description={t("settings.remoteStt.description")}
        descriptionMode="tooltip"
        grouped={true}
      />

      {enabled && (
        <div className="space-y-3 px-4 p-2">
          <SettingContainer
            title={t("settings.remoteStt.displayName")}
            description={t("settings.remoteStt.displayNameDescription")}
            descriptionMode="tooltip"
            layout="stacked"
          >
            <Input
              className="w-full"
              value={nameField.value}
              onChange={nameField.onChange}
              onBlur={nameField.onBlur}
              disabled={isUpdating("remote_stt.name")}
              placeholder={t("settings.remoteStt.displayNamePlaceholder")}
            />
          </SettingContainer>

          <SettingContainer
            title={t("settings.remoteStt.baseUrl")}
            description={t("settings.remoteStt.baseUrlDescription")}
            descriptionMode="tooltip"
            layout="stacked"
          >
            <Input
              className="w-full"
              value={baseUrlField.value}
              onChange={baseUrlField.onChange}
              onBlur={baseUrlField.onBlur}
              disabled={isUpdating("remote_stt.base_url")}
              placeholder={t("settings.remoteStt.baseUrlPlaceholder")}
            />
          </SettingContainer>

          <SettingContainer
            title={t("settings.remoteStt.model")}
            description={t("settings.remoteStt.modelDescription")}
            descriptionMode="tooltip"
            layout="stacked"
          >
            <Input
              className="w-full"
              value={modelField.value}
              onChange={modelField.onChange}
              onBlur={modelField.onBlur}
              disabled={isUpdating("remote_stt.model")}
              placeholder={t("settings.remoteStt.modelPlaceholder")}
            />
          </SettingContainer>

          <SettingContainer
            title={t("settings.remoteStt.apiKey")}
            description={t("settings.remoteStt.apiKeyDescription")}
            descriptionMode="tooltip"
            layout="stacked"
          >
            <Input
              className="w-full"
              type="password"
              value={apiKeyField.value}
              onChange={apiKeyField.onChange}
              onBlur={apiKeyField.onBlur}
              disabled={isUpdating("remote_stt.api_keys")}
              placeholder={t("settings.remoteStt.apiKeyPlaceholder")}
            />
          </SettingContainer>

          <div className="flex items-center gap-2 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={handleTestConnection}
              disabled={testing}
            >
              {testing
                ? t("settings.remoteStt.testing")
                : t("settings.remoteStt.testConnection")}
            </Button>
            {result && (
              <div className="flex-1 rounded-md border border-mid-gray/20 p-3 text-sm">
                {result.ok && result.health.ready ? (
                  <p className="text-sm text-green-400">
                    {t("settings.remoteStt.ready")}
                  </p>
                ) : result.ok ? (
                  <p className="text-sm text-yellow-400">
                    {t("settings.remoteStt.notReady")}
                  </p>
                ) : (
                  <p className="text-sm text-red-400">
                    {t("settings.remoteStt.unreachable")}
                  </p>
                )}
                {result.health.models && result.health.models.length > 0 && (
                  <p className="text-xs text-mid-gray mt-1">
                    {t("settings.remoteStt.availableModels")}:{" "}
                    {result.health.models.join(", ")}
                  </p>
                )}
                {result.health.error && (
                  <p className="text-xs text-mid-gray mt-1">
                    {result.health.error}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const RemoteSTTSettings = React.memo(RemoteSTTSettingsComponent);
RemoteSTTSettings.displayName = "RemoteSTTSettings";
