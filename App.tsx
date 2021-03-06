import React from 'react';
import { EventEmitter } from 'fbemitter';
import { AppState, AsyncStorage, Platform, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Permissions from 'expo-permissions';
import MapView from 'react-native-maps';
import { FontAwesome, MaterialIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

import Button from './components/PrimaryButton';
import Colors from './constants/Colors';

const STORAGE_KEY = 'gpstracking-locations';
const LOCATION_UPDATES_TASK = 'location-updates';

const locationEventsEmitter = new EventEmitter();

export default class App extends React.Component {
  static navigationOptions = {
    title: 'Background location',
  };

  mapViewRef = React.createRef();
  recording = null;

  state = {
    accuracy: Location.Accuracy.High,
    isTracking: false,
    showsBackgroundLocationIndicator: false,
    savedLocations: [],
    initialRegion: null,
    error: null,
  };

  constructor(props) {
    super(props);
    if (Platform.OS === 'android' && !Constants.isDevice) {
      this.setState({
        errorMessage: 'Oops, this will not work on Sketch in an Android emulator. Try it on your device!',
      });
    } else {
      this.didFocus();
    }
  }

  didFocus = async () => {
    let { status } = await Permissions.askAsync(Permissions.LOCATION);

    if (status !== 'granted') {
      AppState.addEventListener('change', this.handleAppStateChange);
      this.setState({
        error:
          'Location permissions are required in order to use this feature. You can manually enable them at any time in the "Location Services" section of the Settings app.',
      });
      return;
    } else {
      this.setState({ error: null });
    }

    let { status: audioStatus } = await Permissions.askAsync(Permissions.AUDIO_RECORDING);
    if (audioStatus !== 'granted') {
      this.setState({
        error: 'Audio recording permissions are required in order to use this feature.',
      });
      return;
    } else {
      this.setState({ error: null });
    }

    const { coords } = await Location.getCurrentPositionAsync();
    const isTracking = await Location.hasStartedLocationUpdatesAsync(LOCATION_UPDATES_TASK);
    const task = (await TaskManager.getRegisteredTasksAsync()).find(
      ({ taskName }) => taskName === LOCATION_UPDATES_TASK
    );
    const savedLocations = await getSavedLocations();
    const accuracy = (task && task.options.accuracy) || this.state.accuracy;

    this.eventSubscription = locationEventsEmitter.addListener('update', locations => {
      this.setState({ savedLocations: locations });
    });

    if (!isTracking) {
      alert('Click `Start tracking` to start getting location updates.');
    }

    this.setState({
      accuracy,
      isTracking,
      savedLocations,
      initialRegion: {
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.004,
        longitudeDelta: 0.002,
      },
    });
  };

  handleAppStateChange = nextAppState => {
    if (nextAppState !== 'active') {
      return;
    }

    if (this.state.initialRegion) {
      AppState.removeEventListener('change', this.handleAppStateChange);
      return;
    }

    this.didFocus();
  };

  componentWillUnmount() {
    if (this.eventSubscription) {
      this.eventSubscription.remove();
    }

    AppState.removeEventListener('change', this.handleAppStateChange);
  }
  async startRecordingAudio() {
    if (this.recording !== null) {
      await this.recording.unloadAsync();
      this.recording = null;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DO_NOT_MIX,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX,
      playThroughEarpieceAndroid: false,
      staysActiveInBackground: true,
    });

    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync(Audio.RECORDING_OPTIONS_PRESET_HIGH_QUALITY);
    await recording.startAsync();
    this.recording = recording;
  }

  async startLocationUpdates(accuracy = this.state.accuracy) {
    await Location.startLocationUpdatesAsync(LOCATION_UPDATES_TASK, {
      accuracy,
      showsBackgroundLocationIndicator: this.state.showsBackgroundLocationIndicator,
    });

    if (!this.state.isTracking) {
      alert(
        'Now you can send app to the background, go somewhere and come back here! You can even terminate the app and it will be woken up when the new significant location change comes out.'
      );
    }
    this.setState({ isTracking: true });
  }

  async stopRecordingAudio() {
    try {
      await this.recording.stopAndUnloadAsync();
    } catch (error) {
      // Do nothing -- we are already unloaded.
    }
  }

  resetRecordingAudio() {
    this.recording = null;
  }

  async resetLocations() {
    await AsyncStorage.removeItem(STORAGE_KEY);
    this.setState({ savedLocations: [] });
  }

  async stopLocationUpdates() {
    await Location.stopLocationUpdatesAsync(LOCATION_UPDATES_TASK);
    this.setState({ isTracking: false });
  }

  async saveLocationsAndRecording() {
    const info = await FileSystem.getInfoAsync(this.recording.getURI());
    console.log(`FILE INFO: ${JSON.stringify(info)}`);
    console.log(`LOCATIONS: ${JSON.stringify(this.state.savedLocations)}`);
  }

  toggleTracking = async () => {
    if (this.state.isTracking) {
      await this.stopLocationUpdates();
      await this.stopRecordingAudio();
      await this.saveLocationsAndRecording();
      this.resetRecordingAudio();
      await this.resetLocations();
    } else {
      await this.startLocationUpdates();
      await this.startRecordingAudio();
    }
  };

  onAccuracyChange = () => {
    const next = Location.Accuracy[this.state.accuracy + 1];
    const accuracy = next ? Location.Accuracy[next] : Location.Accuracy.Lowest;

    this.setState({ accuracy });

    if (this.state.isTracking) {
      // Restart background task with the new accuracy.
      this.startLocationUpdates(accuracy);
    }
  };

  toggleLocationIndicator = async () => {
    const showsBackgroundLocationIndicator = !this.state.showsBackgroundLocationIndicator;

    this.setState({ showsBackgroundLocationIndicator }, async () => {
      if (this.state.isTracking) {
        await this.startLocationUpdates();
      }
    });
  };

  onCenterMap = async () => {
    const { coords } = await Location.getCurrentPositionAsync();
    const mapView = this.mapViewRef.current;

    if (mapView) {
      mapView.animateToRegion({
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.004,
        longitudeDelta: 0.002,
      });
    }
  };

  renderPolyline() {
    const { savedLocations } = this.state;

    if (savedLocations.length === 0) {
      return null;
    }
    return (
      <MapView.Polyline
        coordinates={savedLocations}
        strokeWidth={3}
        strokeColor={Colors.tintColor}
      />
    );
  }

  render() {
    if (this.state.error) {
      return <Text style={styles.errorText}>{this.state.error}</Text>;
    }

    if (!this.state.initialRegion) {
      return (
        <Text>Loading...</Text>
      );
    }

    return (
      <View style={styles.screen}>
        <MapView
          ref={this.mapViewRef}
          style={styles.mapView}
          initialRegion={this.state.initialRegion}
          showsUserLocation
        >
          {this.renderPolyline()}
        </MapView>
        <View style={styles.buttons} pointerEvents="box-none">
          <View style={styles.topButtons}>
            <View style={styles.buttonsColumn}>
              {Platform.OS === 'android' ? null : (
                <Button style={styles.button} onPress={this.toggleLocationIndicator}>
                  <Text>{this.state.showsBackgroundLocationIndicator ? 'Hide' : 'Show'}</Text>
                  <Text> background </Text>
                  <FontAwesome name="location-arrow" size={20} color="white" />
                  <Text> indicator</Text>
                </Button>
              )}
              <Button style={styles.button} onPress={this.onAccuracyChange}>
                Accuracy: {Location.Accuracy[this.state.accuracy]}
              </Button>
            </View>
            <View style={styles.buttonsColumn}>
              <Button style={styles.button} onPress={this.onCenterMap}>
                <MaterialIcons name="my-location" size={20} color="white" />
              </Button>
            </View>
          </View>

          <View style={styles.bottomButtons}>
            {this.state.isTracking ? (
              <Button style={[styles.button, styles.bigButton, this.state.isTracking ? styles.trackingButton : null]} onPress={this.toggleTracking}>
                <Text >Stop tracking</Text>
                <ActivityIndicator style={{ paddingLeft: 15 }} size={15} color="#fff" />
              </Button>
            ) : (
              <Button style={[styles.button, styles.bigButton]} onPress={this.toggleTracking}>
                <Text>Start tracking</Text>
              </Button>
            )}
          </View>
        </View>
      </View>
    );
  }
}

async function getSavedLocations() {
  try {
    const item = await AsyncStorage.getItem(STORAGE_KEY);
    return item ? JSON.parse(item) : [];
  } catch (e) {
    return [];
  }
}

if (Platform.OS !== 'android') {
  TaskManager.defineTask(LOCATION_UPDATES_TASK, async ({ data: { locations } }) => {
    if (locations && locations.length > 0) {
      const savedLocations = await getSavedLocations();
      const newLocations = locations.map(({ coords, timestamp }) => ({
        latitude: coords.latitude,
        longitude: coords.longitude,
        timestamp: timestamp,
      }));

      savedLocations.push(...newLocations);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(savedLocations));

      locationEventsEmitter.emit('update', savedLocations);
    }
  });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  mapView: {
    flex: 1,
  },
  buttons: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: 10,
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  topButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 40,
  },
  bottomButtons: {
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 40,
  },
  buttonsColumn: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  button: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginVertical: 5,
  },
  bigButton: {
    paddingLeft: 50,
    paddingRight: 50,
    paddingBottom: 20,
    paddingTop: 20,
  },
  trackingButton: {
    backgroundColor: Colors.darkTintColor,
  },
  errorText: {
    fontSize: 15,
    color: 'rgba(0,0,0,0.7)',
    margin: 20,
  },
});
