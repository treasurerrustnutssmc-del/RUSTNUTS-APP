import { Ionicons } from '@expo/vector-icons';
import { BottomTabBar, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useClub } from '../data/ClubStore';
import { useChat } from '../data/chat/ChatProvider';
import { pendingFor } from '../domain/access';
import { BoardScreen, ManageMemberScreen } from '../screens/board';
import { BusinessScreen, EditMeetingScreen, MeetingScreen, NewVoteScreen, VoteScreen } from '../screens/business';
import { ChatListScreen, ChatReportsScreen, ChatScreen, NewChatScreen } from '../screens/chat';
import { MediaViewerScreen, PhotosScreen, RideWallScreen } from '../screens/photos';
import { EditBikeScreen, EditContactScreen, EditProfileScreen, MeScreen } from '../screens/me';
import { ChapterDetailScreen, ChaptersScreen, HomeScreen, MemberDetailScreen, MembersScreen } from '../screens/members';
import { RideDetailScreen, RidesScreen } from '../screens/rides';
import { PickCrewScreen } from '../screens/pickCrew';
import { EditRouteScreen, PickRouteScreen, RouteScreen, RoutesScreen } from '../screens/routes';
import { BriefingScreen, EditBriefingScreen } from '../screens/briefing';
import { AskSwapScreen, CallRideScreen, EditHubScreen, HubScreen, PlanRideScreen } from '../screens/ridePlanning';
import { CharityScreen, EditCharityScreen } from '../screens/charity'; // Charity ride sign-ups
import { EditRoadRulesScreen, RoadRulesScreen, RoadRulesSignoffsScreen } from '../screens/roadRules';
import { BookBusScreen, BusBookingScreen, BusScreen } from '../screens/bus';
// Lane E: live ride
import { LiveRideScreen } from '../screens/liveRide';
// Lane E: notifications
import { ReminderSync } from '../data/reminders';
import { LocalAlertSync } from '../data/localAlerts'; // Ride planning extras
// Lane E: share in
import { IncomingShare } from '../data/shareIn';
import { NotificationTaps } from '../data/notificationTaps';
import { ShareInScreen } from '../screens/shareIn';
import {
  DocumentApprovalScreen, DocumentScreen, DocumentSignoffsScreen, DocumentsScreen, NewDocumentScreen, PublishDocumentScreen,
} from '../screens/documents'; // Stage 5C
import { BudgetScreen, ClubFinancesScreen, LedgerEntryScreen, LedgerScreen, MonthReportScreen, NewEntryScreen, TreasuryScreen } from '../screens/treasury';
import { MeetingReportScreen } from '../screens/meetingReport';
// Lane E: ride comms
import { OnAirBar } from '../screens/rideComms';
import { JoinScreen, LoadErrorScreen, PendingScreen, SignInScreen, WelcomeScreen } from '../screens/public';
import { CheckInScreen, OpenMeetingScreen, RunCheckinScreen } from '../screens/checkin';
import { ChapterFeesScreen, MemberFeesScreen } from '../screens/fees';
import { AttendanceScreen } from '../screens/attendance';
import { MembershipCardScreen } from '../screens/card';
import { FngReviewScreen } from '../screens/fng';
// Stage 7: social extras
// Stage 5D: conduct records, merch, national contributions and new chapters
import { ConductRecordScreen, ConductScreen, RecordConductScreen } from '../screens/conduct';
import { MerchItemScreen, MerchOrderScreen, MerchScreen, ProposeMerchScreen } from '../screens/merch';
import { ChapterProposalScreen, ContributionScreen, NationalScreen, ProposeChapterScreen, ProposeContributionScreen } from '../screens/national';
import { BirthdayScreen, OnThisDayScreen } from '../screens/social';
import { EditMechanicScreen, MechanicScreen, MySkillsScreen, WhoCanHelpScreen } from '../screens/help';
import { EditListingScreen, ListingScreen, SwapSellScreen } from '../screens/swap';
import { BuildsScreen, BuildThreadScreen, PostBuildUpdateScreen } from '../screens/builds';
import { EditHistoryEntryScreen, EditHonourScreen, HistoryScreen } from '../screens/history';
import { AwardScreen, BraggingScreen, NominateScreen, OpenAwardScreen } from '../screens/brag';
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
  const { width } = useWindowDimensions();
  // Each tab's label gets the tab's width less the bar's own 5pt padding each side; "Members", the
  // widest label, is about 5 times the font size wide in the club stencil (5.2 leaves a margin).
  const labelSize = Math.min(11.5, Math.floor(((width / (isBoard ? 6 : 5) - 10) / 5.2) * 2) / 2);
  return (
    <>
      {/* Lane E: share in */}
      <IncomingShare />
      <NotificationTaps />
      <Tabs.Navigator
        // Lane E: ride comms. While a call is on, its bar sits just above the tabs.
        tabBar={(props) => (
          <>
            <OnAirBar />
            <BottomTabBar {...props} />
          </>
        )}
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
          // Six tabs on a narrow phone can't fit "Members" at full size, so every label gets the same
          // size worked out from the tab width (labelSize above). The stock label is used: Android's
          // adjustsFontSizeToFit sized short labels too narrow and clipped "Chat" to "Cha". No letter
          // spacing either (Android leaves it out of the width), and no font scaling, so the size holds.
          tabBarLabelStyle: { fontFamily: fonts.stencil, fontSize: labelSize, lineHeight: 16 },
          tabBarAllowFontScaling: false,
          tabBarItemStyle: { paddingHorizontal: 0 },
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={TAB_ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />
          ),
        })}
      >
        <Tabs.Screen name="Home" component={HomeScreen} options={{ title: 'Home', headerTitle: () => <Skull size={30} /> }} />
        <Tabs.Screen
          name="Chats"
          component={ChatListScreen}
          options={{
            title: 'Chat',
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
      <LocalAlertSync />
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
          <>
            <Stack.Screen name="Pending" component={PendingScreen} options={{ headerShown: false }} />
            <Stack.Screen name="CheckIn" component={CheckInScreen} options={{ title: 'Check in' }} />
            {/* Stage 5C: applicants read the Registered Rules and the Constitution (15.7) */}
            <Stack.Screen name="Documents" component={DocumentsScreen} options={{ title: 'Club documents' }} />
            <Stack.Screen name="Document" component={DocumentScreen} options={{ title: 'Document' }} />
          </>
        ) : (
          <>
            <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="MemberDetail" component={MemberDetailScreen} options={{ title: 'Member' }} />
            <Stack.Screen name="Chapters" component={ChaptersScreen} options={{ title: 'Chapters' }} />
            <Stack.Screen name="ChapterDetail" component={ChapterDetailScreen} options={{ title: 'Chapter' }} />
            <Stack.Screen name="RideDetail" component={RideDetailScreen} options={{ title: 'Ride' }} getId={({ params }) => params.rideId} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit profile' }} />
            <Stack.Screen name="EditBike" component={EditBikeScreen} options={({ route }) => ({ title: route.params?.bikeId ? 'Edit bike' : 'Add a bike' })} />
            <Stack.Screen name="EditContact" component={EditContactScreen} options={({ route }) => ({ title: route.params?.contactId ? 'Emergency contact' : 'Add a contact' })} />
            <Stack.Screen name="ManageMember" component={ManageMemberScreen} options={{ title: 'Manage member' }} />
            {/* Stage 5: meetings and votes */}
            <Stack.Screen name="Business" component={BusinessScreen} options={{ title: 'Meetings and votes' }} />
            <Stack.Screen name="Meeting" component={MeetingScreen} options={{ title: 'Meeting' }} />
            <Stack.Screen name="EditMeeting" component={EditMeetingScreen} options={({ route }) => ({ title: route.params?.meetingId ? 'Edit meeting' : 'Call a meeting' })} />
            <Stack.Screen name="Vote" component={VoteScreen} options={{ title: 'Vote' }} />
            <Stack.Screen name="NewVote" component={NewVoteScreen} options={{ title: 'New vote' }} />
            {/* ride crew */}
            <Stack.Screen name="PickCrew" component={PickCrewScreen} options={{ title: 'Pick crew' }} />
            {/* ride routes */}
            <Stack.Screen name="Routes" component={RoutesScreen} options={{ title: 'Route library' }} />
            <Stack.Screen name="Route" component={RouteScreen} options={{ title: 'Route' }} />
            <Stack.Screen name="EditRoute" component={EditRouteScreen} options={({ route }) => ({ title: route.params?.routeId ? 'Edit route' : 'Add route' })} />
            <Stack.Screen name="PickRoute" component={PickRouteScreen} options={{ title: 'Choose route' }} />
            {/* ride briefings */}
            <Stack.Screen name="Briefing" component={BriefingScreen} options={{ title: 'Briefing card' }} />
            <Stack.Screen name="EditBriefing" component={EditBriefingScreen} options={{ title: 'Edit briefing' }} />
            <Stack.Screen name="PlanRide" component={PlanRideScreen} options={{ title: 'Plan the ride' }} />
            <Stack.Screen name="CallRide" component={CallRideScreen} options={{ title: 'Ride’s off or postponed' }} />
            <Stack.Screen name="Hub" component={HubScreen} options={{ title: 'Registrations' }} />
            <Stack.Screen name="EditHub" component={EditHubScreen} options={{ title: 'Run the hub' }} />
            {/* Charity ride sign-ups */}
            <Stack.Screen name="Charity" component={CharityScreen} options={{ title: 'Charity ride' }} />
            <Stack.Screen name="EditCharity" component={EditCharityScreen} options={{ title: 'Run sign-ups' }} />
            <Stack.Screen name="AskSwap" component={AskSwapScreen} options={{ title: 'Ask to swap' }} />
            {/* Road Rules sign-off */}
            <Stack.Screen name="RoadRules" component={RoadRulesScreen} options={{ title: 'Road Rules' }} />
            <Stack.Screen name="EditRoadRules" component={EditRoadRulesScreen} options={{ title: 'Publish Road Rules' }} />
            <Stack.Screen name="RoadRulesSignoffs" component={RoadRulesSignoffsScreen} options={{ title: 'Who’s signed' }} />
            {/* The Rusty Bus */}
            <Stack.Screen name="Bus" component={BusScreen} options={{ title: 'Rusty Bus' }} />
            <Stack.Screen name="BusBooking" component={BusBookingScreen} options={{ title: 'Booking' }} />
            <Stack.Screen name="BookBus" component={BookBusScreen} options={{ title: 'Book the Rusty Bus' }} />
            {/* Lane E: live ride */}
            <Stack.Screen name="LiveRide" component={LiveRideScreen} options={{ title: 'Live ride' }} getId={({ params }) => params.rideId} />
            {/* Stage 4: members and money */}
            <Stack.Screen name="CheckIn" component={CheckInScreen} options={{ title: 'Check in' }} />
            <Stack.Screen name="RunCheckin" component={RunCheckinScreen} options={{ title: 'Check-in' }} />
            <Stack.Screen name="OpenMeeting" component={OpenMeetingScreen} options={{ title: 'Open a check-in' }} />
            <Stack.Screen name="FngReview" component={FngReviewScreen} options={{ title: 'FNG review' }} />
            <Stack.Screen name="MemberFees" component={MemberFeesScreen} options={{ title: 'Fees' }} />
            <Stack.Screen name="ChapterFees" component={ChapterFeesScreen} options={{ title: 'Chapter fees' }} />
            {/* Attendance rules, Big 4 rides and the membership card */}
            <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: 'Attendance' }} />
            <Stack.Screen name="MembershipCard" component={MembershipCardScreen} options={{ title: 'Membership card' }} />
            {/* Stage 3 (lane B): chats and photos */}
            {/* One screen per chat (and per ride below), so opening another one from a notification never
                reuses the one on screen with its half-typed message. */}
            <Stack.Screen name="Chat" component={ChatScreen} options={{ title: 'Chat' }} getId={({ params }) => params.chatId} />
            <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: 'New private chat' }} />
            <Stack.Screen name="ChatReports" component={ChatReportsScreen} options={{ title: 'Reports' }} />
            <Stack.Screen name="Photos" component={PhotosScreen} options={{ title: 'Photos' }} />
            <Stack.Screen name="RideWall" component={RideWallScreen} options={{ title: 'Ride wall' }} />
            {/* Lane E: share in */}
            <Stack.Screen name="ShareIn" component={ShareInScreen} options={{ title: 'Share to the club' }} />
            {/* Stage 5B: treasurer */}
            <Stack.Screen name="Treasury" component={TreasuryScreen} options={{ title: 'Treasury' }} />
            <Stack.Screen name="Ledger" component={LedgerScreen} options={{ title: 'Ledger' }} />
            <Stack.Screen name="LedgerEntry" component={LedgerEntryScreen} options={{ title: 'Entry' }} />
            <Stack.Screen name="NewEntry" component={NewEntryScreen} options={{ title: 'New entry' }} />
            <Stack.Screen name="MonthReport" component={MonthReportScreen} options={{ title: 'Treasurer’s Report' }} />
            <Stack.Screen name="MeetingReport" component={MeetingReportScreen} options={{ title: 'Report for a meeting' }} />
            <Stack.Screen name="Budget" component={BudgetScreen} options={{ title: 'Budget' }} />
            <Stack.Screen name="ClubFinances" component={ClubFinancesScreen} options={{ title: 'Club finances' }} />
            {/* Stage 5D: conduct records, merch, national contributions and new chapters */}
            <Stack.Screen name="Conduct" component={ConductScreen} options={{ title: 'Conduct records' }} />
            <Stack.Screen name="ConductRecord" component={ConductRecordScreen} options={{ title: 'Record' }} />
            <Stack.Screen name="RecordConduct" component={RecordConductScreen} options={{ title: 'Record a decision' }} />
            <Stack.Screen name="Merch" component={MerchScreen} options={{ title: 'Merch' }} />
            <Stack.Screen name="MerchItem" component={MerchItemScreen} options={{ title: 'Merch' }} />
            <Stack.Screen name="MerchOrder" component={MerchOrderScreen} options={{ title: 'Order' }} />
            <Stack.Screen name="ProposeMerch" component={ProposeMerchScreen} options={{ title: 'Put up an item' }} />
            <Stack.Screen name="National" component={NationalScreen} options={{ title: 'National' }} />
            <Stack.Screen name="Contribution" component={ContributionScreen} options={{ title: 'Contribution' }} />
            <Stack.Screen name="ProposeContribution" component={ProposeContributionScreen} options={{ title: 'Ask the chapters' }} />
            <Stack.Screen name="ChapterProposal" component={ChapterProposalScreen} options={{ title: 'New chapter' }} />
            <Stack.Screen name="ProposeChapter" component={ProposeChapterScreen} options={{ title: 'New chapter' }} />
            {/* Stage 7: social extras */}
            <Stack.Screen name="Birthday" component={BirthdayScreen} options={{ title: 'Birthday shout-out' }} />
            <Stack.Screen name="OnThisDay" component={OnThisDayScreen} options={{ title: 'On this day' }} />
            {/* Stage 5C: document library */}
            <Stack.Screen name="Documents" component={DocumentsScreen} options={{ title: 'Club documents' }} />
            <Stack.Screen name="Document" component={DocumentScreen} options={{ title: 'Document' }} />
            <Stack.Screen name="NewDocument" component={NewDocumentScreen} options={{ title: 'Add a document' }} />
            <Stack.Screen name="PublishDocument" component={PublishDocumentScreen} options={{ title: 'Publish a version' }} />
            <Stack.Screen name="DocumentApproval" component={DocumentApprovalScreen} options={{ title: 'Record approval' }} />
            <Stack.Screen name="DocumentSignoffs" component={DocumentSignoffsScreen} options={{ title: 'Who’s signed' }} />
            <Stack.Screen name="WhoCanHelp" component={WhoCanHelpScreen} options={{ title: 'Who can help?' }} />
            <Stack.Screen name="Mechanic" component={MechanicScreen} options={{ title: 'Workshop' }} />
            <Stack.Screen
              name="EditMechanic"
              component={EditMechanicScreen}
              options={({ route }) => ({ title: route.params?.mechanicId ? 'Edit workshop' : 'Add a workshop' })}
            />
            <Stack.Screen name="MySkills" component={MySkillsScreen} options={{ title: 'I can help with' }} />
            <Stack.Screen name="SwapSell" component={SwapSellScreen} options={{ title: 'Swap and sell' }} />
            <Stack.Screen name="Listing" component={ListingScreen} options={{ title: 'Listing' }} />
            <Stack.Screen
              name="EditListing"
              component={EditListingScreen}
              options={({ route }) => ({ title: route.params?.listingId ? 'Change listing' : 'List something' })}
            />
            <Stack.Screen name="Builds" component={BuildsScreen} options={{ title: 'Garage builds' }} />
            <Stack.Screen name="BuildThread" component={BuildThreadScreen} options={{ title: 'Build' }} />
            <Stack.Screen name="PostBuildUpdate" component={PostBuildUpdateScreen} options={{ title: 'Post an update' }} />
            <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'History' }} />
            <Stack.Screen
              name="EditHistoryEntry"
              component={EditHistoryEntryScreen}
              options={({ route }) => ({ title: route.params?.entryId ? 'Change the entry' : 'Add to the timeline' })}
            />
            <Stack.Screen
              name="EditHonour"
              component={EditHonourScreen}
              options={({ route }) => ({ title: route.params?.honourId ? 'Change the honour' : 'Add an honour' })}
            />
            <Stack.Screen name="Bragging" component={BraggingScreen} options={{ title: 'Bragging rights' }} />
            <Stack.Screen name="Award" component={AwardScreen} options={{ title: 'Award' }} />
            <Stack.Screen name="Nominate" component={NominateScreen} options={{ title: 'Nominate' }} />
            <Stack.Screen name="OpenAward" component={OpenAwardScreen} options={{ title: 'Open an award' }} />
            <Stack.Screen name="MediaViewer" component={MediaViewerScreen} options={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
