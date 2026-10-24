import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type TabParams = {
  Home: undefined;
  Members: undefined;
  Chapters: undefined;
  Board: undefined;
  Me: undefined;
};

export type RootParams = {
  // signed out
  Welcome: undefined;
  SignIn: undefined;
  Join: undefined;
  // waiting for approval
  Pending: undefined;
  // signed in
  Tabs: NavigatorScreenParams<TabParams>;
  MemberDetail: { memberId: string };
  ChapterDetail: { chapterId: string };
  EditProfile: undefined;
  EditBike: { bikeId?: string };
  EditContact: { contactId?: string };
  ManageMember: { memberId: string };
};

export type RootScreen<K extends keyof RootParams> = NativeStackScreenProps<RootParams, K>;

export type TabScreen<K extends keyof TabParams> = CompositeScreenProps<
  BottomTabScreenProps<TabParams, K>,
  NativeStackScreenProps<RootParams>
>;
