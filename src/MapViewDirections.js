import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Polyline } from 'react-native-maps';
import isEqual from 'lodash.isequal';

const WAYPOINT_LIMIT = 10;

class MapViewDirections extends Component {

	constructor(props) {
		super(props);

		this.state = {
			coordinates: null,
			distance: null,
			duration: null,
			alternativeRoutes: [],
			// Use selectedRouteIndex from props if provided, otherwise default to 0
			selectedRouteIndex: props.selectedRouteIndex !== undefined ? props.selectedRouteIndex : 0,
		};
	}

	componentDidMount() {
		this.fetchAndRenderRoute(this.props);
	}

	componentDidUpdate(prevProps) {
		if (!isEqual(prevProps.origin, this.props.origin) ||
			!isEqual(prevProps.destination, this.props.destination) ||
			!isEqual(prevProps.waypoints, this.props.waypoints) ||
			!isEqual(prevProps.mode, this.props.mode) ||
			!isEqual(prevProps.precision, this.props.precision) ||
			!isEqual(prevProps.splitWaypoints, this.props.splitWaypoints) ||
			prevProps.showAlternatives !== this.props.showAlternatives) {
			if (this.props.resetOnChange === false) {
				this.fetchAndRenderRoute(this.props);
			} else {
				this.resetState(() => {
					this.fetchAndRenderRoute(this.props);
				});
			}
		}

		// If selectedRouteIndex prop changes, update the state and selected route
		if (this.props.selectedRouteIndex !== undefined && prevProps.selectedRouteIndex !== this.props.selectedRouteIndex) {
			if (this.props.selectedRouteIndex >= 0 && this.props.selectedRouteIndex < this.state.alternativeRoutes.length) {
				this.selectAlternativeRoute(this.props.selectedRouteIndex, false); // Don't call onSelectRoute again
			}
		}
	}

	resetState = (cb = null) => {
		this.setState({
			coordinates: null,
			distance: null,
			duration: null,
			alternativeRoutes: [],
			selectedRouteIndex: this.props.selectedRouteIndex !== undefined ? this.props.selectedRouteIndex : 0,
		}, cb);
	}

	// Handle selection of an alternative route
	selectAlternativeRoute = (index, callOnSelectRoute = true) => {
		if (index >= 0 && index < this.state.alternativeRoutes.length) {
			const selectedRoute = this.state.alternativeRoutes[index];

			// If onSelectRoute is provided, call it
			if (this.props.onSelectRoute && callOnSelectRoute) {
				this.props.onSelectRoute(index);
			}

			// If selectedRouteIndex is managed externally, don't update internal state directly
			// The update will come via props through componentDidUpdate
			if (this.props.selectedRouteIndex === undefined) {
				this.setState({
					coordinates: selectedRoute.coordinates,
					distance: selectedRoute.distance,
					duration: selectedRoute.duration,
					selectedRouteIndex: index,
				}, () => {
					// Call onReady with the selected route data
					if (this.props.onReady) {
						this.props.onReady(selectedRoute);
					}
				});
			} else {
				// Even if managed externally, we might need to update coordinates, distance, duration
				// if the parent only manages the index.
				// However, it's better if the parent also handles this based on the new index.
				// For now, let's assume if selectedRouteIndex is provided, the parent handles everything.
				// If not, we update the local state for display.
				this.setState({
					coordinates: selectedRoute.coordinates,
					distance: selectedRoute.distance,
					duration: selectedRoute.duration,
					// selectedRouteIndex will be updated via props
				}, () => {
					// Call onReady with the selected route data
					if (this.props.onReady) {
						this.props.onReady(selectedRoute);
					}
				});
			}
		}
	}

	decode(t) {
		let points = [];
		for (let step of t) {
			let encoded = step.polyline.points;
			let index = 0, len = encoded.length;
			let lat = 0, lng = 0;
			while (index < len) {
				let b, shift = 0, result = 0;
				do {
					b = encoded.charAt(index++).charCodeAt(0) - 63;
					result |= (b & 0x1f) << shift;
					shift += 5;
				} while (b >= 0x20);

				let dlat = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
				lat += dlat;
				shift = 0;
				result = 0;
				do {
					b = encoded.charAt(index++).charCodeAt(0) - 63;
					result |= (b & 0x1f) << shift;
					shift += 5;
				} while (b >= 0x20);
				let dlng = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
				lng += dlng;

				points.push({ latitude: (lat / 1E5), longitude: (lng / 1E5) });
			}
		}
		return points;
	}

	fetchAndRenderRoute = (props) => {

		let {
			origin: initialOrigin,
			destination: initialDestination,
			waypoints: initialWaypoints = [],
			apikey,
			onStart,
			onReady,
			onError,
			mode = 'DRIVING',
			language = 'en',
			optimizeWaypoints,
			splitWaypoints,
			directionsServiceBaseUrl = 'https://maps.googleapis.com/maps/api/directions/json',
			region,
			precision = 'low',
			timePrecision = 'none',
			channel,
		} = props;

		if (!apikey) {
			console.warn(`MapViewDirections Error: Missing API Key`); // eslint-disable-line no-console
			return;
		}

		if (!initialOrigin || !initialDestination) {
			return;
		}

		const timePrecisionString = timePrecision==='none' ? '' : timePrecision;
		
		// Routes array which we'll be filling.
		// We'll perform a Directions API Request for reach route
		const routes = [];

		// We need to split the waypoints in chunks, in order to not exceede the max waypoint limit
		// ~> Chunk up the waypoints, yielding multiple routes
		if (splitWaypoints && initialWaypoints && initialWaypoints.length > WAYPOINT_LIMIT) {
			// Split up waypoints in chunks with chunksize WAYPOINT_LIMIT
			const chunckedWaypoints = initialWaypoints.reduce((accumulator, waypoint, index) => {
				const numChunk = Math.floor(index / WAYPOINT_LIMIT); 
				accumulator[numChunk] = [].concat((accumulator[numChunk] || []), waypoint); 
				return accumulator;
			}, []);

			// Create routes for each chunk, using:
			// - Endpoints of previous chunks as startpoints for the route (except for the first chunk, which uses initialOrigin)
			// - Startpoints of next chunks as endpoints for the route (except for the last chunk, which uses initialDestination)
			for (let i = 0; i < chunckedWaypoints.length; i++) {
				routes.push({
					waypoints: chunckedWaypoints[i],
					origin: (i === 0) ? initialOrigin : chunckedWaypoints[i-1][chunckedWaypoints[i-1].length - 1],
					destination: (i === chunckedWaypoints.length - 1) ? initialDestination : chunckedWaypoints[i+1][0],
				});
			}
		}
		
		// No splitting of the waypoints is requested/needed.
		// ~> Use one single route
		else {
			routes.push({
				waypoints: initialWaypoints,
				origin: initialOrigin,
				destination: initialDestination,
			});
		}

		// Perform a Directions API Request for each route
		Promise.all(routes.map((route, index) => {
			let {
				origin,
				destination,
				waypoints,
			} = route;

			if (origin.latitude && origin.longitude) {
				origin = `${origin.latitude},${origin.longitude}`;
			}

			if (destination.latitude && destination.longitude) {
				destination = `${destination.latitude},${destination.longitude}`;
			}

			waypoints = waypoints
				.map(waypoint => (waypoint.latitude && waypoint.longitude) ? `${waypoint.latitude},${waypoint.longitude}` : waypoint)
				.join('|');

			if (optimizeWaypoints) {
				waypoints = `optimize:true|${waypoints}`;
			}

			if (index === 0) {
				onStart && onStart({
					origin,
					destination,
					waypoints: initialWaypoints,
				});
			}

			return (
				this.fetchRoute(directionsServiceBaseUrl, origin, waypoints, destination, apikey, mode, language, region, precision, timePrecisionString, channel)
					.then(result => {
						return result;
					})
					.catch(errorMessage => {
						return Promise.reject(errorMessage);
					})
			);
		})).then(results => {
			// Combine all Directions API Request results into one
			const result = results.reduce((acc, { distance, duration, coordinates, fare, legs, waypointOrder }) => {
				acc.coordinates = [
					...acc.coordinates,
					...coordinates,
				];
				acc.distance += distance;
				acc.duration += duration;
				acc.fares = [
					...acc.fares,
					fare,
				];
				acc.legs = legs;
				acc.waypointOrder = [
					...acc.waypointOrder,
					waypointOrder,
				];

				return acc;
			}, {
				coordinates: [],
				distance: 0,
				duration: 0,
				fares: [],
				legs: [],
				waypointOrder: [],
			});

			// Store alternative routes if available
			const alternativeRoutes = results.reduce((acc, result) => {
				if (result.alternativeRoutes) {
					return [...acc, ...result.alternativeRoutes];
				}
				return acc;
			}, []);

			// Plot it out and call the onReady callback
			const currentSelectedRouteIndex = this.props.selectedRouteIndex !== undefined ? this.props.selectedRouteIndex : 0;
			let newCoordinates = result.coordinates;
			let newDistance = result.distance;
			let newDuration = result.duration;

			if (alternativeRoutes.length > 0 && currentSelectedRouteIndex < alternativeRoutes.length) {
				const selectedRouteData = alternativeRoutes[currentSelectedRouteIndex];
				newCoordinates = selectedRouteData.coordinates;
				newDistance = selectedRouteData.distance;
				newDuration = selectedRouteData.duration;
			}


			this.setState({
				coordinates: newCoordinates,
				distance: newDistance,
				duration: newDuration,
				alternativeRoutes: alternativeRoutes,
				// selectedRouteIndex is managed by props or defaults to 0
				selectedRouteIndex: currentSelectedRouteIndex,
			}, function() {
				if (onReady) {
					// If alternatives are present, onReady should reflect the initially selected one
					if (alternativeRoutes.length > 0 && currentSelectedRouteIndex < alternativeRoutes.length) {
						onReady(alternativeRoutes[currentSelectedRouteIndex]);
					} else {
						onReady(result);
					}
				}
			});
		})
			.catch(errorMessage => {
				this.resetState();
				console.warn(`MapViewDirections Error: ${errorMessage}`); // eslint-disable-line no-console
				onError && onError(errorMessage);
			});
	}

	fetchRoute(directionsServiceBaseUrl, origin, waypoints, destination, apikey, mode, language, region, precision, timePrecision, channel) {
		const { showAlternatives } = this.props;

		// Define the URL to call. Only add default parameters to the URL if it's a string.
		let url = directionsServiceBaseUrl;
		if (typeof (directionsServiceBaseUrl) === 'string') {
			url += `?origin=${origin}&waypoints=${waypoints}&destination=${destination}&key=${apikey}&mode=${mode.toLowerCase()}&language=${language}&region=${region}`;
			
			// Add alternatives parameter if showAlternatives is true
			if (showAlternatives) {
				url += `&alternatives=true`;
			}
			
			if(timePrecision){
				url+=`&departure_time=${timePrecision}`;
			}
			if(channel){
				url+=`&channel=${channel}`;
			}
		}

		return fetch(url)
			.then(response => response.json())
			.then(json => {

				if (json.status !== 'OK') {
					const errorMessage = json.error_message || json.status || 'Unknown error';
					return Promise.reject(errorMessage);
				}

				if (json.routes.length) {
					// Process all routes if showAlternatives is true, otherwise just the first one
					const routes = this.props.showAlternatives ? json.routes : [json.routes[0]];
					
					const processedRoutes = routes.map(route => ({
						distance: route.legs.reduce((carry, curr) => {
							return carry + curr.distance.value;
						}, 0) / 1000,
						duration: route.legs.reduce((carry, curr) => {
							return carry + (curr.duration_in_traffic ? curr.duration_in_traffic.value : curr.duration.value);
						}, 0) / 60,
						coordinates: (
							(precision === 'low') ?
								this.decode([{polyline: route.overview_polyline}]) :
								route.legs.reduce((carry, curr) => {
									return [
										...carry,
										...this.decode(curr.steps),
									];
								}, [])
						),
						fare: route.fare,
						waypointOrder: route.waypoint_order,
						legs: route.legs,
					}));

					// Return the first route as the main result, but include all routes
					return Promise.resolve({
						...processedRoutes[0],
						alternativeRoutes: processedRoutes,
					});

				} else {
					return Promise.reject();
				}
			})
			.catch(err => {
				return Promise.reject(`Error on GMAPS route request: ${err}`);
			});
	}

	render() {
		const { alternativeRoutes } = this.state;
		const coordinates = this.state.coordinates;
		const selectedRouteIndex = this.props.selectedRouteIndex !== undefined ? this.props.selectedRouteIndex : this.state.selectedRouteIndex;


		if (!coordinates) {
			return null;
		}

		const {
			origin, // eslint-disable-line no-unused-vars
			waypoints, // eslint-disable-line no-unused-vars
			splitWaypoints, // eslint-disable-line no-unused-vars
			destination, // eslint-disable-line no-unused-vars
			apikey, // eslint-disable-line no-unused-vars
			onReady, // eslint-disable-line no-unused-vars
			onError, // eslint-disable-line no-unused-vars
			mode, // eslint-disable-line no-unused-vars
			language, // eslint-disable-line no-unused-vars
			region, // eslint-disable-line no-unused-vars
			precision, // eslint-disable-line no-unused-vars
			showAlternatives, // eslint-disable-line no-unused-vars
			alternativeStrokeColor,
			alternativeStrokeColors,
			alternativeStrokeWidth,
			strokeColor,
			strokeWidth,
			strokeColors,
			selectedRouteIndex: selectedRouteIndexProp, // aliasing to avoid conflict
			onSelectRoute, // eslint-disable-line no-unused-vars
			...props
		} = this.props;

		const AlternativeRoutesComponent = ({strokeColor: altStrokeColor, strokeColors: altStrokeColors, strokeWidth: altStrokeWidth}) => {
			return alternativeRoutes.map((route, index) => {
					// Skip the selected route as it will be rendered with the user's specified style
					if (index === selectedRouteIndex) return null;

					return (
						<Polyline
							key={`alternative_${index}`}
							coordinates={route.coordinates}
							zIndex={0}
							fillColor={altStrokeColor}
							strokeColors={altStrokeColors}
							strokeColor={altStrokeColor}
							strokeWidth={altStrokeWidth}
							tappable={true}
							onPress={() => this.selectAlternativeRoute(index)}
							{...props}
						/>
					);
				});
		}

		// Render main route and alternative routes
		return (
			<>
				{coordinates && (
					<Polyline
						key="main_route"
						coordinates={coordinates}
						zIndex={1}
						strokeColor={strokeColor}
						strokeWidth={strokeWidth}
						strokeColors={strokeColors}
						{...props}
					/>
				)}
				<AlternativeRoutesComponent strokeWidth={alternativeStrokeWidth} strokeColor={alternativeStrokeColor} strokeColors={alternativeStrokeColors}/>
			</>
		);
	}

}

MapViewDirections.propTypes = {
	origin: PropTypes.oneOfType([
		PropTypes.string,
		PropTypes.shape({
			latitude: PropTypes.number.isRequired,
			longitude: PropTypes.number.isRequired,
		}),
	]),
	waypoints: PropTypes.arrayOf(
		PropTypes.oneOfType([
			PropTypes.string,
			PropTypes.shape({
				latitude: PropTypes.number.isRequired,
				longitude: PropTypes.number.isRequired,
			}),
		]),
	),
	destination: PropTypes.oneOfType([
		PropTypes.string,
		PropTypes.shape({
			latitude: PropTypes.number.isRequired,
			longitude: PropTypes.number.isRequired,
		}),
	]),
	apikey: PropTypes.string.isRequired,
	onStart: PropTypes.func,
	onReady: PropTypes.func,
	onError: PropTypes.func,
	mode: PropTypes.oneOf(['DRIVING', 'BICYCLING', 'TRANSIT', 'WALKING']),
	language: PropTypes.string,
	resetOnChange: PropTypes.bool,
	optimizeWaypoints: PropTypes.bool,
	splitWaypoints: PropTypes.bool,
	directionsServiceBaseUrl: PropTypes.string,
	region: PropTypes.string,
	precision: PropTypes.oneOf(['high', 'low']),
	timePrecision: PropTypes.oneOf(['now', 'none']),
	channel: PropTypes.string,
	showAlternatives: PropTypes.bool,
	selectedRouteIndex: PropTypes.number,
	onSelectRoute: PropTypes.func,
};

export default MapViewDirections;
