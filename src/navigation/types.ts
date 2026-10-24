import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CrewRole } from '../domain/types';

export type TabParams = {
  Home: undefined;
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
  // ride crew
  PickCrew: { rideId: string; role: CrewRole };
  // Lane E: live ride
  LiveRide: { rideId: string };
};

export type RootScreen<K extends keyof RootParams> = NativeStackScreenProps<RootParams, K>;

export type TabScreen<K extends keyof TabParams> = CompositeScreenProps<
  BottomTabScreenProps<TabParams, K>,
  NativeStackScreenProps<RootParams>
>;
