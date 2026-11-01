// Small pieces shared by the Stage 5D screens (conduct records, merch, national): a typed date,
// a pick-one row, a member picker with a find field, and the one-line refusal under a button.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatAuDate, parseAuDate, typeDate } from '../domain/dates';
import { displayName } from '../domain/profile';
import type { Member } from '../domain/types';
import { colors, fonts, radius, space, type } from '../theme';
import { Button, Field, Ionicons, Label, Notice, Row, Small, Stack, type IconName } from '../ui/primitives';

export type Msg = { tone: 'ok' | 'danger'; text: string } | null;

/** A DD/MM/YYYY field's text and the ISO date it reads as ('' when blank or not a date). */
export function useDate(initial: string | null) {
  const [text, setRaw] = useState(initial ? formatAuDate(initial) : '');
  const iso = parseAuDate(text.trim()) ?? '';
  return {
    text,
    setText: (t: string) => setRaw(typeDate(t)),
    iso,
    error: text.trim() && !iso ? 'Use DD/MM/YYYY, like 08/11/2026.' : null,
  };
}

export function DateField({ label, date, hint }: { label: string; date: ReturnType<typeof useDate>; hint?: string }) {
  return (
    <Field
      label={label}
      value={date.text}
      onChangeText={date.setText}
      placeholder="DD/MM/YYYY"
      keyboardType="number-pad"
      maxLength={10}
      hint={hint}
      error={date.error}
    />
  );
}

/** A pick-one (or, with `multi`, pick-many) row: a mark, a stencil label and an optional line under it. */
export function RadioRow({
  label, sub, on, last, onPress, multi,
}: { label: string; sub?: string; on: boolean; last: boolean; onPress: () => void; multi?: boolean }) {
  const icon: IconName = multi ? (on ? 'checkbox' : 'square-outline') : on ? 'radio-button-on' : 'radio-button-off';
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: on }}
      aria-checked={on}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.radio,
        last && { borderBottomWidth: 0 },
        (pressed || hovered) && { backgroundColor: colors.steel },
      ]}
    >
      <Ionicons name={icon} size={22} color={on ? colors.bone : colors.boneMute} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={2} style={[type.name, !on && { color: colors.boneDim }]}>
          {label}
        </Text>
        {sub ? <Text style={styles.meta}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

const matches = (m: Member, find: string) => {
  const q = find.trim().toLowerCase();
  return !q || displayName(m).toLowerCase().includes(q) || m.fullName.toLowerCase().includes(q);
};

/**
 * Picks members from `choices` with a find field. One at a time by default; with `multi`, a set.
 * `sub` gives the line under a name (their chapter, say).
 */
export function MemberPicker({
  label, choices, picked, onChange, multi, sub, hint,
}: {
  label: string;
  choices: Member[];
  picked: string[];
  onChange: (ids: string[]) => void;
  multi?: boolean;
  sub?: (m: Member) => string | undefined;
  hint?: string;
}) {
  const [find, setFind] = useState('');
  // Whoever's picked stays in the list while finding someone else.
  const shown = choices
    .filter((m) => picked.includes(m.id) || matches(m, find))
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const toggle = (id: string) => {
    if (!multi) return onChange([id]);
    onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  };
  return (
    <View style={{ gap: 6 }}>
      {choices.length > 8 ? (
        <Field label={label} value={find} onChangeText={setFind} placeholder="Find by road name or name" autoCapitalize="none" autoCorrect={false} hint={hint} />
      ) : (
        <>
          <Label>{label}</Label>
          {hint ? <Small>{hint}</Small> : null}
        </>
      )}
      <View style={styles.pickList}>
        {shown.length === 0 ? (
          <View style={{ padding: space.md }}>
            <Small>{choices.length === 0 ? 'Nobody to pick.' : 'Nobody by that name.'}</Small>
          </View>
        ) : (
          shown.map((m, i) => (
            <RadioRow
              key={m.id}
              multi={multi}
              label={displayName(m)}
              sub={sub?.(m) ?? (m.fullName !== displayName(m) ? m.fullName : undefined)}
              on={picked.includes(m.id)}
              last={i === shown.length - 1}
              onPress={() => toggle(m.id)}
            />
          ))
        )}
      </View>
    </View>
  );
}

/** A stencil fact line with an icon, as on the bus and ride screens. */
export function Fact({ icon, text, tone }: { icon: IconName; text: string; tone?: 'warn' | 'danger' | 'ok' }) {
  const color = tone ? colors[tone] : colors.boneDim;
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={18} color={tone ? color : colors.boneMute} />
      <Text style={[styles.factText, { color }]}>{text}</Text>
    </View>
  );
}

/** The button, and whatever stops it (or went wrong) under it in a live region. */
export function ActionWithReason({
  label, icon, kind = 'primary', reason, busy, onPress, big,
}: {
  label: string;
  icon?: IconName;
  kind?: 'primary' | 'secondary';
  reason: string | null;
  busy?: boolean;
  onPress: () => void;
  big?: boolean;
}) {
  return (
    <Stack gap={space.sm}>
      <Button label={label} icon={icon} kind={kind} busy={busy} onPress={onPress} style={big ? { minHeight: 56 } : undefined} />
      <View accessibilityLiveRegion="polite" role="alert">
        {reason ? <Notice tone="danger">{reason}</Notice> : null}
      </View>
    </Stack>
  );
}

/** Runs an action with a busy flag, turning a refusal into a message. */
export function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: 'ok', text: ok });
      return true;
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, msg, setMsg, run };
}

/** One fewer / one more, 1 to `max`. The club shop's design and cart screens use it too. */
export function QtyStepper({ qty, onChange, max = 10, label = 'How many' }: { qty: number; onChange: (n: number) => void; max?: number; label?: string | null }) {
  const step = (icon: 'remove' | 'add', label: string, to: number, disabled: boolean) => (
    <Pressable
      onPress={() => onChange(to)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1,
        borderColor: colors.lineStrong, backgroundColor: pressed ? colors.steel : 'transparent', opacity: disabled ? 0.45 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={colors.bone} />
    </Pressable>
  );
  return (
    <View style={{ gap: 6 }}>
      {label ? <Label>{label}</Label> : null}
      <Row style={{ gap: space.md }}>
        {step('remove', 'One fewer', qty - 1, qty <= 1)}
        <Text style={[type.h2, { fontVariant: ['tabular-nums'], minWidth: 32, textAlign: 'center' }]} accessibilityLiveRegion="polite">{qty}</Text>
        {step('add', 'One more', qty + 1, qty >= max)}
      </Row>
    </View>
  );
}


export const styles = StyleSheet.create({
  radio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  pickList: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.ink2 },
  meta: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, color: colors.boneMute },
  metaDim: { fontFamily: fonts.stencil, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, color: colors.boneDim },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  factText: { fontFamily: fonts.stencil, fontSize: 16, lineHeight: 22, letterSpacing: 0.4, flexShrink: 1 },
  count: { fontFamily: fonts.stencil, fontSize: 16, color: colors.boneMute },
  quote: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: space.md, backgroundColor: colors.steel },
});
