import { useCallback, useEffect, useState } from "react";
import { Button, Card, Flex, Stack, Text, TextInput } from "@sanity/ui";
import { useClient, useCurrentUser, type StringInputProps } from "sanity";
import { encryptSecret, publicKeyFingerprint, SECRETS_ID, SECRETS_TYPE, type StoredSecret } from "../core/engineModel";

export const STUDIO_API_VERSION = "2024-01-01";

/** Shown in place of the input when the site has no public key to encrypt with. */
export const KEY_STORAGE_NOT_CONFIGURED = "Translation key storage is not configured on this server yet.";

type Saved = Pick<StoredSecret, "last4" | "savedAt"> | null;

/**
 * The input for the site's Anthropic API key. It never holds a saved key:
 * what is typed is encrypted in the browser with the site's public key, only
 * the ciphertext is written (to the private `i18n.secrets` document, with the
 * editor's own session), and the field is cleared. After that the Studio can
 * only say that a key is saved and what its last four characters are.
 */
export function ApiKeyInput(props: StringInputProps) {
  const options = (props.schemaType.options ?? {}) as { i18n?: { publicKey?: string } };
  const publicKey = (options.i18n?.publicKey ?? "").trim();
  const client = useClient({ apiVersion: STUDIO_API_VERSION });
  const user = useCurrentUser();

  const [saved, setSaved] = useState<Saved>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const refresh = useCallback(async () => {
    try {
      const stored = await client.fetch<Saved>(`*[_id == $id][0].anthropicKey{ last4, savedAt }`, { id: SECRETS_ID });
      setSaved(stored && stored.last4 ? stored : null);
    } catch {
      setSaved(null);
    }
    setLoaded(true);
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    const value = entry.trim();
    if (value.length < 8) {
      setProblem("That does not look like a complete key.");
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      const [ciphertext, keyFingerprint] = await Promise.all([encryptSecret(publicKey, value), publicKeyFingerprint(publicKey)]);
      const anthropicKey: StoredSecret = {
        ciphertext,
        last4: value.slice(-4),
        savedAt: new Date().toISOString(),
        keyFingerprint,
        ...(user?.name ? { savedBy: user.name } : {}),
      };
      await client.createOrReplace({ _id: SECRETS_ID, _type: SECRETS_TYPE, anthropicKey });
      setEntry("");
      setEditing(false);
      await refresh();
    } catch {
      setProblem("The key could not be saved. Check that you are allowed to edit Site Settings, then try again.");
    }
    setBusy(false);
  }, [client, entry, publicKey, refresh, user]);

  const remove = useCallback(async () => {
    setBusy(true);
    setProblem("");
    try {
      await client.delete(SECRETS_ID);
      await refresh();
    } catch {
      setProblem("The key could not be removed. Try again.");
    }
    setBusy(false);
  }, [client, refresh]);

  if (publicKey === "") {
    return (
      <Card padding={3} radius={2} tone="caution" border>
        <Stack space={3}>
          <Text size={1} weight="medium">
            {KEY_STORAGE_NOT_CONFIGURED}
          </Text>
          <Text size={1} muted>
            A developer needs to add the two I18N keys to the hosting environment. Until then no API key can be saved, and nothing else on the site is affected.
          </Text>
        </Stack>
      </Card>
    );
  }

  if (!loaded) {
    return (
      <Card padding={3} radius={2} border>
        <Text size={1} muted>
          Checking for a saved key
        </Text>
      </Card>
    );
  }

  if (saved && !editing) {
    const when = saved.savedAt ? new Date(saved.savedAt).toLocaleDateString() : "";
    return (
      <Card padding={3} radius={2} tone="positive" border>
        <Flex align="center" gap={3} wrap="wrap">
          <Stack space={2} flex={1}>
            <Text size={1} weight="medium">
              Key saved, ending in ...{saved.last4}
            </Text>
            <Text size={1} muted>
              {when ? `Saved ${when}. ` : ""}The key is stored encrypted and cannot be shown again.
            </Text>
          </Stack>
          {props.readOnly ? null : (
            <Flex gap={2}>
              <Button text="Replace" mode="ghost" disabled={busy} onClick={() => setEditing(true)} />
              <Button text="Remove" mode="ghost" tone="critical" disabled={busy} onClick={() => void remove()} />
            </Flex>
          )}
        </Flex>
        {problem ? (
          <Text size={1} style={{ marginTop: 12 }}>
            {problem}
          </Text>
        ) : null}
      </Card>
    );
  }

  if (props.readOnly) {
    return (
      <Card padding={3} radius={2} border>
        <Text size={1} muted>
          No key saved. Add it on the default-language Site Settings.
        </Text>
      </Card>
    );
  }

  return (
    <Stack space={3}>
      <Flex gap={2}>
        <Card flex={1}>
          <TextInput
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste the key"
            value={entry}
            disabled={busy}
            onChange={(event) => setEntry(event.currentTarget.value)}
          />
        </Card>
        <Button text={busy ? "Saving" : "Save key"} tone="primary" disabled={busy || entry.trim() === ""} onClick={() => void save()} />
        {saved ? <Button text="Cancel" mode="ghost" disabled={busy} onClick={() => { setEditing(false); setEntry(""); setProblem(""); }} /> : null}
      </Flex>
      <Text size={1} muted>
        The key is encrypted in your browser before it is saved and is never shown again.
      </Text>
      {problem ? <Text size={1}>{problem}</Text> : null}
    </Stack>
  );
}
