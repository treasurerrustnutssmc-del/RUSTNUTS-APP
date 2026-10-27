import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FeedItem } from '../data/chat/chatContext';
import type { PickedMedia } from '../domain/chat';
import type { CrewRole } from '../domain/types';

export type TabParams = {
  Home: undefined;
  Chats: undefined; // Stage 3 (lane B), labelled Chat
  Members: undefined;
  Rides: undefined;
  Board: undefined;
  Me: undefined;
};

export type RootParams = {
  // signed out
  Welcome: undefined;
  SignIn: { joining?: boolean } | undefined;
  Join: undefined;
  // waiting for approval
  Pending: undefined;
  // signed in, but the club data couldn't be loaded
  LoadError: undefined;
  // signed in
  Tabs: NavigatorScreenParams<TabParams>;
  MemberDetail: { memberId: string };
  Chapters: undefined;
  ChapterDetail: { chapterId: string };
  RideDetail: { rideId: string };
  EditProfile: undefined;
  EditBike: { bikeId?: string };
  EditContact: { contactId?: string };
  ManageMember: { memberId: string };
  // Stage 5: meetings and votes
  Business: undefined;
  Meeting: { meetingId: string };
  EditMeeting: { meetingId?: string; chapterId?: string | null } | undefined;
  Vote: { voteId: string };
  NewVote: { chapterId?: string | null; meetingId?: string; subjectMemberId?: string } | undefined;
  // ride crew
  PickCrew: { rideId: string; role: CrewRole };
  // ride routes
  Routes: undefined;
  Route: { routeId: string };
  EditRoute: { routeId?: string } | undefined;
  PickRoute: { rideId: string };
  // ride briefings
  Briefing: { rideId: string };
  EditBriefing: { rideId: string };
  PlanRide: { rideId: string };
  CallRide: { rideId: string };
  Hub: { rideId: string };
  EditHub: { rideId: string };
  AskSwap: { rideId: string };
  // Road Rules sign-off. An older version number opens that version read-only.
  RoadRules: { version?: number } | undefined;
  EditRoadRules: undefined;
  RoadRulesSignoffs: undefined;
  // The Rusty Bus. Book opened from a ride starts with that ride and its days.
  Bus: undefined;
  BusBooking: { bookingId: string };
  BookBus: { rideId?: string } | undefined;
  // Lane E: live ride
  LiveRide: { rideId: string };
  // Stage 4: members and money
  CheckIn: undefined;
  RunCheckin: { sessionId: string };
  OpenMeeting: undefined;
  FngReview: { memberId: string };
  MemberFees: { memberId: string };
  ChapterFees: { chapterId: string };
  // Attendance rules, Big 4 rides and the membership card
  Attendance: { chapterId?: string } | undefined;
  MembershipCard: undefined;
  // Stage 3 (lane B): chats and photos
  Chat: { chatId: string; /** Lane E: share in. What was shared, as the starting draft. */ shared?: { text: string; media: PickedMedia[] } };
  NewChat: undefined;
  ChatReports: undefined;
  Photos: undefined;
  RideWall: { rideId: string };
  MediaViewer: { items: FeedItem[]; index: number };
  // Stage 7: social extras
  Birthday: undefined;
  OnThisDay: undefined;
  // Lane E: share in
  ShareIn: { text: string; media: PickedMedia[]; notes: string[] };
  // Stage 5B: treasurer. A fund is 'club' or a chapter id.
  Treasury: undefined;
  Ledger: { fund: string };
  LedgerEntry: { entryId: string };
  NewEntry: { kind?: 'credit' | 'debit'; fund?: string } | undefined;
  MonthReport: { month: string };
  Budget: { fund: string; fy?: number };
  ClubFinances: undefined;
};

export type RootScreen<K extends keyof RootParams> = NativeStackScreenProps<RootParams, K>;

export type TabScreen<K extends keyof TabParams> = CompositeScreenProps<
  BottomTabScreenProps<TabParams, K>,
  NativeStackScreenProps<RootParams>
>;
