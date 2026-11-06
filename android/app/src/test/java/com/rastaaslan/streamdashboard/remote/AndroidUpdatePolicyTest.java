package com.rastaaslan.streamdashboard.remote;
import org.junit.Test;
import static org.junit.Assert.*;

public class AndroidUpdatePolicyTest {
 private final String a=new String(new char[64]).replace('\0','a');
 private final String b=new String(new char[64]).replace('\0','b');
 @Test public void samePackageAndEverySignerAreRequired(){
  assertTrue(AndroidUpdatePolicy.sameIdentity("app.qa","app.qa",new String[]{a,b},new String[]{b,a}));
  assertFalse(AndroidUpdatePolicy.sameIdentity("app.qa","app",new String[]{a},new String[]{a}));
  assertFalse(AndroidUpdatePolicy.sameIdentity("app.qa","app.qa",new String[]{a},new String[]{b}));
  assertFalse(AndroidUpdatePolicy.sameIdentity("app.qa","app.qa",new String[]{a,b},new String[]{a}));
  assertFalse(AndroidUpdatePolicy.sameIdentity("app.qa","app.qa",new String[]{},new String[]{}));
 }
 @Test public void upgradeRequiresHigherVersionFreshOfflineAndExplicitConsent(){
  assertTrue(AndroidUpdatePolicy.canCommit("prepared",3000001,3000002,true,true));
  assertTrue(AndroidUpdatePolicy.canCommit("deferred",3000001,3000002,true,true));
  assertFalse(AndroidUpdatePolicy.canCommit("prepared",3000001,3000001,true,true));
  assertFalse(AndroidUpdatePolicy.canCommit("prepared",3000002,3000001,true,true));
  assertFalse(AndroidUpdatePolicy.canCommit("prepared",3000001,3000002,false,true));
  assertFalse(AndroidUpdatePolicy.canCommit("prepared",3000001,3000002,true,false));
 }
 @Test public void interruptedCommitCannotBeReplacedOrReplayed(){
  for(String phase:new String[]{"committing","committed","awaiting-user","readback-required","corrupt"}){
   assertFalse(AndroidUpdatePolicy.canPrepare(phase));
   assertFalse(AndroidUpdatePolicy.canCommit(phase,1,2,true,true));
  }
  assertTrue(AndroidUpdatePolicy.canPrepare("failed"));
  assertTrue(AndroidUpdatePolicy.canPrepare("installed"));
 }
 @Test public void versionAndBroadcastAloneNeverConfirmAnInstall(){
  assertTrue(AndroidUpdatePolicy.confirmsInstall(2,2,a,a,true,"/data/app","/data/app"));
  assertFalse(AndroidUpdatePolicy.confirmsInstall(2,1,a,a,true,"/data/app","/data/app"));
  assertFalse(AndroidUpdatePolicy.confirmsInstall(2,2,a,b,true,"/data/app","/data/app"));
  assertFalse(AndroidUpdatePolicy.confirmsInstall(2,2,a,a,false,"/data/app","/data/app"));
  assertFalse(AndroidUpdatePolicy.confirmsInstall(2,2,a,a,true,"/data/app","/different"));
 }
 @Test public void forwardSystemRecoveryKeepsTheOldAttemptAndRequiresHigherSameSignedIdentityAndData(){
  assertTrue(AndroidUpdatePolicy.confirmsForwardRecovery(2,3,true,"/data/app","/data/app"));
  assertTrue(AndroidUpdatePolicy.canPrepare("superseded"));
  assertFalse(AndroidUpdatePolicy.confirmsForwardRecovery(2,2,true,"/data/app","/data/app"));
  assertFalse(AndroidUpdatePolicy.confirmsForwardRecovery(2,1,true,"/data/app","/data/app"));
  assertFalse(AndroidUpdatePolicy.confirmsForwardRecovery(2,3,false,"/data/app","/data/app"));
  assertFalse(AndroidUpdatePolicy.confirmsForwardRecovery(2,3,true,"/data/app","/other"));
 }
}
