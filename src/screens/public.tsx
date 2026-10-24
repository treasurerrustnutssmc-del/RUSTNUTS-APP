import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { useClub } from '../data/ClubStore';
import { DEMO_PERSONAS } from '../data/demoData';
import { STATUS_LABEL } from '../domain/labels';
import { displayName, initials } from '../domain/profile';
import type { RootScreen } from '../navigation/types';
import { colors, space } from '../theme';
import {
  Avatar,
  Body,
  Button,
  Card,
  Choices,
  Display,
  Field,
  H1,
  H2,
  IconBadge,
  Label,
  ListRow,
  Logo,
  Notice,
  Row,
  Screen,
  Small,
  Stack,
} from '../ui/primitives';

const SUPPORT_URL = 'https://www.rustnutssmc.com.au/resources.html';

export function WelcomeScreen({ navigation }: RootScreen<'Welcome'>) {
  const { data, isDemo } = useClub();
  return (
    <Screen padTop>
      <View style={{ alignItems: 'center', paddingTop: space.md }}>
        <Logo width={280} />
      </View>
      <Stack gap={space.sm}>
        <Display>Rust Till Dust</Display>
        <Body>
          The Rustnuts members’ app. Rides, chat, members and club business in one place, built by the club for
          the club.
        </Body>
      </Stack>
      <Stack gap={space.sm}>
        <Button label="Sign in" icon="log-in-outline" onPress={() => navigation.navigate('SignIn')} />
        <Button
          label="Ask to join"
          kind="secondary"
          onPress={() => (isDemo ? navigation.navigate('Join') : navigation.navigate('SignIn', { joining: true }))}
        />
      </Stack>

      <Card style={{ padding: 0, gap: 0 }}>
        <View style={{ padding: space.lg, paddingBottom: space.sm }}>
          <H2>Our chapters</H2>
        </View>
        {data.chapters.map((c, i) => (
          <ListRow
            key={c.id}
            last={i === data.chapters.length - 1}
            left={<IconBadge icon="flag" tone="red" />}
            title={c.name}
            subtitle={`${c.area}, ${c.state}`}
          />
        ))}
      </Card>

      <Card>
        <Row style={{ gap: space.md, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <IconBadge icon="heart" />
          <View style={{ flex: 1, gap: 4 }}>
            <Body strong>No one rides alone</Body>
            <Small>
              Lifeline is there 24/7 on 13 11 14. Mental health, legal and rider support is on our Support page.
            </Small>
          </View>
        </Row>
        <Button
          label="Support and resources"
          kind="secondary"
          icon="open-outline"
          onPress={() => Linking.openURL(SUPPORT_URL)}
        />
      </Card>

      <Small style={{ textAlign: 'center' }}>Rustnuts Social Motorcycle Club Incorporated · Greater Melbourne</Small>
    </Screen>
  );
}

export function SignInScreen({ route }: RootScreen<'SignIn'>) {
  const { isDemo, signInAs, data, sendCode, verifyCode } = useClub();
  const joining = route.params?.joining ?? false;
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoNote, setDemoNote] = useState(false);
  const people = DEMO_PERSONAS.filter((p) => p.memberId !== null);
  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());

  const send = async () => {
    if (isDemo) {
      setDemoNote(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendCode(email);
      setStep('code');
      setCode('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyCode(email, code);
      // Signing in switches the app over to the right screens by itself.
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H1>{joining ? 'First, your email' : 'Sign in'}</H1>
        <Body>
          {step === 'code'
            ? `We've emailed a code to ${email.trim()}. It lasts an hour. Check your junk folder if it's not there.`
            : joining
              ? 'No passwords. Enter your email and we’ll send a code to confirm it’s you, then you can fill in your details.'
              : 'No passwords. Enter your email and we’ll send a code to sign in with.'}
        </Body>
      </Stack>

      {step === 'email' ? (
        <>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
            onSubmitEditing={() => emailOk && send()}
          />
          <Button label="Email me a code" icon="mail-outline" onPress={send} disabled={!emailOk} busy={busy} />
        </>
      ) : (
        <>
          <Field
            label="Code from the email"
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
            placeholder="123456"
            keyboardType="number-pad"
            inputMode="numeric"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={10}
            onSubmitEditing={() => code.length >= 6 && verify()}
          />
          <Button label="Sign in" icon="log-in-outline" onPress={verify} disabled={code.length < 6} busy={busy} />
          <Row style={{ gap: space.sm }}>
            <Button label="Send a new code" kind="quiet" onPress={send} />
            <Button label="Different email" kind="quiet" onPress={() => { setStep('email'); setError(null); }} />
          </Row>
        </>
      )}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {isDemo ? (
        <>
          {demoNote ? (
            <Notice tone="warn" title="This is the demo build">
              No emails go out. Pick someone below to see the app as them.
            </Notice>
          ) : null}
          <Card style={{ padding: 0, gap: 0 }}>
            <View style={{ padding: space.lg, paddingBottom: space.sm, gap: 4 }}>
              <Label>Demo: sign in as</Label>
              <Small>Made-up members, one for each access level.</Small>
            </View>
            {people.map((p, i) => {
              const m = data.members.find((x) => x.id === p.memberId)!;
              return (
                <ListRow
                  key={p.level}
                  last={i === people.length - 1}
                  left={<Avatar text={initials(m)} size={40} />}
                  title={`${displayName(m)} · ${p.label}`}
                  subtitle={p.blurb}
                  onPress={() => signInAs(p.memberId)}
                />
              );
            })}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

type JoinAs = 'introduced' | 'supporter' | 'family';

export function JoinScreen() {
  const { data, submitApplication, isDemo, authEmail, signOut } = useClub();
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    roadName: '',
    email: '',
    phone: '',
    introducedBy: '',
    note: '',
    make: '',
    model: '',
    year: '',
  });
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [joinAs, setJoinAs] = useState<JoinAs>('introduced');
  const [showErrors, setShowErrors] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const errors = {
    fullName: form.fullName.trim() ? null : 'Add your full name.',
    email: !isDemo || /^\S+@\S+\.\S+$/.test(form.email.trim()) ? null : 'Add an email address we can send your code to.',
    phone: form.phone.replace(/\D/g, '').length >= 8 ? null : 'Add a mobile number.',
    chapter: chapterId ? null : 'Pick the chapter you ride with.',
    year:
      !form.year.trim() || (/^\d{4}$/.test(form.year.trim()) && Number(form.year) >= 1900)
        ? null
        : 'Use a four-digit year, like 2019.',
  };
  const valid = Object.values(errors).every((e) => e === null);
  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : null);

  const submit = async () => {
    if (!valid || !chapterId) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      await submitApplication({
      chapterId,
      fullName: form.fullName,
      roadName: form.roadName,
      email: isDemo ? form.email : authEmail ?? '',
      phone: form.phone,
      introducedBy: form.introducedBy,
      note: form.note,
      status: joinAs,
      bike: form.make.trim()
        ? { make: form.make, model: form.model, year: form.year.trim() ? Number(form.year) : null }
        : null,
      });
    } catch (e) {
      setSubmitError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack gap={space.sm}>
        <H1>Ask to join</H1>
        <Body>
          Your chapter’s board checks every request. Most people are introduced by a member and come along to a
          couple of meetings and a ride first.
        </Body>
      </Stack>

      <Card>
        <Field label="Full name" value={form.fullName} onChangeText={set('fullName')} autoComplete="name" error={err('fullName')} />
        <Field label="Road name (if you have one)" value={form.roadName} onChangeText={set('roadName')} hint="What everyone calls you on a ride." />
        {isDemo ? (
          <Field
            label="Email"
            value={form.email}
            onChangeText={set('email')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
            error={err('email')}
          />
        ) : (
          <View style={{ gap: 2 }}>
            <Label>Email</Label>
            <Body>{authEmail}</Body>
          </View>
        )}
        <Field label="Mobile" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" inputMode="tel" error={err('phone')} />
      </Card>

      <Card>
        <Choices
          label="Chapter"
          options={data.chapters.map((c) => ({ value: c.id, label: `${c.name} · ${c.area}` }))}
          value={chapterId}
          onChange={setChapterId}
        />
        {err('chapter') ? <Small style={{ color: colors.danger }}>{err('chapter')}</Small> : null}
        <Choices<JoinAs>
          label="I'm joining as"
          options={[
            { value: 'introduced', label: 'A rider' },
            { value: 'supporter', label: STATUS_LABEL.supporter },
            { value: 'family', label: 'Family of a member' },
          ]}
          value={joinAs}
          onChange={setJoinAs}
        />
        <Field label="Who introduced you?" value={form.introducedBy} onChangeText={set('introducedBy')} placeholder="A member's name or road name" />
      </Card>

      <Card>
        <Label>Your bike (optional)</Label>
        <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Field label="Make" value={form.make} onChangeText={set('make')} placeholder="Harley-Davidson" />
          </View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Field label="Model" value={form.model} onChangeText={set('model')} placeholder="Street Bob" />
          </View>
        </Row>
        <Field label="Year" value={form.year} onChangeText={set('year')} keyboardType="number-pad" inputMode="numeric" maxLength={4} error={err('year')} />
      </Card>

      <Field
        label="Anything the board should know?"
        value={form.note}
        onChangeText={set('note')}
        multiline
        placeholder="How long you've been riding, who you ride with…"
      />

      {showErrors && !valid ? <Notice tone="danger" title="A few things to fix">Check the fields marked in red.</Notice> : null}
      {submitError ? <Notice tone="danger">{submitError}</Notice> : null}
      <Button label="Send my request" icon="paper-plane-outline" onPress={submit} busy={busy} />
      {!isDemo ? <Button label="Sign out" kind="quiet" onPress={() => signOut()} /> : null}
    </Screen>
  );
}

export function PendingScreen() {
  const { me, data, signOut } = useClub();
  if (!me) return null;
  const chapter = data.chapters.find((c) => c.id === me.chapterId);
  const declined = me.approval === 'declined';
  const priv = data.privates.find((p) => p.memberId === me.id);

  return (
    <Screen padTop>
      <View style={{ alignItems: 'center' }}>
        <Logo width={180} />
      </View>
      {declined ? (
        <Stack gap={space.sm}>
          <H1>Request not approved</H1>
          <Body>
            The {chapter?.name} board didn’t approve this request. If you think that’s a mistake, have a chat with
            the member who introduced you.
          </Body>
        </Stack>
      ) : (
        <Stack gap={space.sm}>
          <H1>Thanks, {me.fullName.split(' ')[0]}</H1>
          <Body>
            The {chapter?.name} chapter board has your request. Once they approve it, you’ll get a notification and
            the rest of the app opens up.
          </Body>
        </Stack>
      )}

      {!declined && me.status === 'introduced' ? (
        <Card>
          <H2>While you wait</H2>
          {[
            ['people', 'Get along to two official club meetings'],
            ['speedometer', 'Come on a ride organised by a member'],
            ['time', 'The introduction phase runs for three months'],
          ].map(([icon, text]) => (
            <Row key={text} style={{ gap: space.md, flexWrap: 'nowrap' }}>
              <IconBadge icon={icon as 'people'} />
              <Body style={{ flex: 1 }}>{text}</Body>
            </Row>
          ))}
        </Card>
      ) : null}

      <Card>
        <Label>What you sent</Label>
        <Row style={{ gap: space.md, flexWrap: 'nowrap' }}>
          <Avatar text={initials(me)} />
          <View style={{ flex: 1, gap: 2 }}>
            <Body strong>{me.fullName}{me.roadName ? ` · ${me.roadName}` : ''}</Body>
            <Small>
              {chapter?.name} chapter · joining as {me.status === 'introduced' ? 'a rider' : STATUS_LABEL[me.status].toLowerCase()}
            </Small>
            {priv?.introducedBy ? <Small>Introduced by {priv.introducedBy}</Small> : null}
          </View>
        </Row>
      </Card>

      <Button label="Sign out" kind="secondary" icon="log-out-outline" onPress={() => signOut()} />
    </Screen>
  );
}
