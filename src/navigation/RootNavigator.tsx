import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClub } from '../data/ClubStore';
import { useChat } from '../data/chat/ChatProvider';
import { pendingFor } from '../domain/access';
import { BoardScreen, ManageMemberScreen } from '../screens/board';
import { ChatListScreen, ChatReportsScreen, ChatScreen, NewChatScreen } from '../screens/chat';
import { MediaViewerScreen, PhotosScreen, RideWallScreen } from '../screens/photos';
import { EditBikeScreen, EditContactScreen, EditProfileScreen, MeScreen } from '../screens/me';
import { ChapterDetailScreen, ChaptersScreen, HomeScreen, MemberDetailScreen, MembersScreen } from '../screens/members';
import { RideDetailScreen, RidesScreen } from '../screens/rides';
import { PickCrewScreen } from '../screens/pickCrew';
// Lane E: live ride
import { LiveRideScreen } from '../screens/liveRide';
// Lane E: notifications
import { ReminderSync } from '../data/reminders';
// Lane E: share in
import { IncomingShare } from '../data/shareIn';
import { ShareInScreen } from '../screens/shareIn';
import { JoinScreen, LoadErrorScreen, PendingScreen, SignInScreen, WelcomeScreen } from '../screens/public';
import { colors, fonts } from '../theme';
import { Skull } from '../ui/primitives';
import type { RootParams, TabParams } from './types';

const Stack = createNativeStackNavigator<RootParams>();
const Tabs = createBottomTabNavigator<TabParams>();

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.redText,
    background: colors.ink,
    card: colors.ink,
    text: colors.bone,
    border: colors.line,
    notification: colors.redBright,
  },
};

const headerOptions = {
  headerStyle: { backgroundColor: colors.ink },
  headerTintColor: colors.bone,
  headerTitleStyle: { fontFamily: fonts.stencil, fontSize: 20, color: colors.bone },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.ink },
} as const;

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const TAB_ICONS: Record<keyof TabParams, [IconName, IconName]> = {
  Home: ['home', 'home-outline'],
  Chats: ['chatbubbles', 'chatbubbles-outline'],
  Members: ['people', 'people-outline'],
  Rides: ['calendar', 'calendar-outline'],
  Board: ['shield', 'shield-outline'],
  Me: ['person-circle', 'person-circle-outline'],
};

function MainTabs() {
  const { level, me, data } = useClub();
  const isBoard = level === 'board' || level === 'national';
  const waiting = isBoard ? pendingFor(me, data).length : 0;
  const { unreadTotal } = useChat();
  const insets = useSafeAreaInsets();
  return (
    <>
      {/* Lane E: share in */}
      <IncomingShare />
      <Tabs.Navigator
        screenOptions={({ route }) => ({
          ...headerOptions,
          tabBarAccessibilityLabel:
            route.name === 'Board' && waiting > 0
              ? `Board, ${waiting} waiting`
              : route.name === 'Chats'
                ? unreadTotal > 0 ? `Chat, ${unreadTotal} unread` : 'Chat'
                : route.name,
          tabBarStyle: {
            backgroundColor: colors.ink2,
            borderTopColor: colors.line,
            height: 66 + insets.bottom,
            paddingTop: 6,
            paddingBottom: insets.bottom + 6,
          },
          tabBarHideOnKeyboard: true, // otherwise Android lifts the tab bar on top of the keyboard
          tabBarActiveTintColor: colors.redText,
          tabBarInactiveTintColor: colors.boneMute,
          tabBarLabelStyle: { fontFamily: fonts.stencil, fontSize: 11.5, lineHeight: 16, letterSpacing: 0.3 },
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={TAB_ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />
          ),
        })}
      >
        <Tabs.Screen name="Home" component={HomeScreen} options={{ title: 'Home', headerTitle: () => <Skull size={30} />, tabBarLabel: 'Home' }} />
        <Tabs.Screen
          name="Chats"
          component={ChatListScreen}
          options={{
            title: 'Chat',
            tabBarLabel: 'Chat',
            tabBarBadge: unreadTotal > 0 ? (unreadTotal > 99 ? '99+' : unreadTotal) : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.redBright, fontFamily: fonts.stencil },
          }}
        />
        <Tabs.Screen name="Rides" component={RidesScreen} />
        <Tabs.Screen name="Members" component={MembersScreen} />
        {isBoard ? (
          <Tabs.Screen
            name="Board"
            component={BoardScreen}
            options={{ tabBarBadge: waiting > 0 ? waiting : undefined, tabBarBadgeStyle: { backgroundColor: colors.redBright } }}
          />
        ) : null}
        <Tabs.Screen name="Me" component={MeScreen} />
      </Tabs.Navigator>
    </>
  );
}

export function RootNavigator() {
  const { level, me, needsApplication, loadError } = useClub();
  const stackKey = loadError ? 'load-error' : me?.id ?? (needsApplication ? 'applying' : 'signed-out');
  return (
    <NavigationContainer theme={navTheme}>
      {/* Lane E: notifications */}
      <ReminderSync />
      {/* Keyed by who's signed in, so switching people always starts fresh on their home screen. */}
      <Stack.Navigator key={stackKey} screenOptions={headerOptions}>
        {loadError ? (
          <Stack.Screen name="LoadError" component={LoadErrorScreen} options={{ headerShown: false }} />
        ) : needsApplication ? (
          <Stack.Screen name="Join" component={JoinScreen} options={{ title: 'Ask to join' }} />
        ) : level === 'public' ? (
          <>
            <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
            <Stack.Screen name="SignIn" component={SignInScreen} options={{ title: '' }} />
            <Stack.Screen name="Join" component={JoinScreen} options={{ title: '' }} />
          </>
        ) : level === 'pending' ? (
          <Stack.Screen name="Pending" component={PendingScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="MemberDetail" component={MemberDetailScreen} options={{ title: 'Member' }} />
            <Stack.Screen name="Chapters" component={ChaptersScreen} options={{ title: 'Chapters' }} />
            <Stack.Screen name="ChapterDetail" component={ChapterDetailScreen} options={{ title: 'Chapter' }} />
            <Stack.Screen name="RideDetail" component={RideDetailScreen} options={{ title: 'Ride' }} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit profile' }} />
            <Stack.Screen name="EditBike" component={EditBikeScreen} options={({ route }) => ({ title: route.params?.bikeId ? 'Edit bike' : 'Add a bike' })} />
            <Stack.Screen name="EditContact" component={EditContactScreen} options={({ route }) => ({ title: route.params?.contactId ? 'Emergency contact' : 'Add a contact' })} />
            <Stack.Screen name="ManageMember" component={ManageMemberScreen} options={{ title: 'Manage member' }} />
            {/* ride crew */}
            <Stack.Screen name="PickCrew" component={PickCrewScreen} options={{ title: 'Pick crew' }} />
            {/* Lane E: live ride */}
            <Stack.Screen name="LiveRide" component={LiveRideScreen} options={{ title: 'Live ride' }} />
            {/* Stage 3 (lane B): chats and photos */}
            <Stack.Screen name="Chat" component={ChatScreen} options={{ title: 'Chat' }} />
            <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: 'New private chat' }} />
            <Stack.Screen name="ChatReports" component={ChatReportsScreen} options={{ title: 'Reports' }} />
            <Stack.Screen name="Photos" component={PhotosScreen} options={{ title: 'Photos' }} />
            <Stack.Screen name="RideWall" component={RideWallScreen} options={{ title: 'Ride wall' }} />
            {/* Lane E: share in */}
            <Stack.Screen name="ShareIn" component={ShareInScreen} options={{ title: 'Share to the club' }} />
            <Stack.Screen name="MediaViewer" component={MediaViewerScreen} options={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
