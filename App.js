Ext.define('CustomApp', {
	extend: 'Rally.app.TimeboxScopedApp',
	scopeType: 'release',
	OUTLIER_THRESHOLD: 1.5,
	app: null,
	scatterChart: null,
	boxPlotChart: null,
	
	// If the scope changes, such as the release filter, update ourselves
	onScopeChange: function( scope ) {
		app = this;
		app.callParent( arguments );
		app.fetchWorkItems( scope );
	},
	
	// Collect the stories that were accepted within the timebox
	fetchWorkItems:function( scope ){
		// Remove any existing components
		while( app.down( '*' ) ) {
			app.down( '*' ).destroy();
		}
		
		// Show loading message
		app._myMask = new Ext.LoadMask(Ext.getBody(), {msg:"Calculating...Please wait."});
		app._myMask.show();
	
		// Look for stories that were started and accepted within the release timebox	
		var filters = [];
		var startDate = scope.record.raw.ReleaseStartDate;
		var endDate = scope.record.raw.ReleaseDate;
		var startDateFilter = Ext.create('Rally.data.wsapi.Filter', {
			property : 'InProgressDate',
			operator: '>=',
			value: startDate
		});
		
		var endDateFilter = Ext.create('Rally.data.wsapi.Filter', {
			property : 'AcceptedDate',
			operator: '<=',
			value: endDate
		});
		
		var estimateFilter = Ext.create('Rally.data.wsapi.Filter', {
			property : 'PlanEstimate',
			operator: '>',
			value: '0'
		});
		
		filters.push( startDateFilter );
		filters.push( endDateFilter );
		filters.push( estimateFilter );

		var dataScope = app.getContext().getDataContext();
		var store = Ext.create(
			'Rally.data.wsapi.Store',
			{
				model: 'UserStory',
				fetch: ['FormattedID','Name','InProgressDate','AcceptedDate','PlanEstimate'],
				context: dataScope,
				pageSize: 2000,
				limit: 2000,
				sorters:[{
					property:'PlanEstimate',
					direction: 'ASC'
				}]
			},
			app
		);

		store.addFilter( filters, false );
		// TODO: If there are over 2000 work items, we would need to fetch a second page (or more)
		store.loadPage(1, {
			scope: app,
			callback: function( records, operation ) {
				if( operation.wasSuccessful() ) {
					// Create a lookup by estimate for the stories of that estimate
					var estimateTimes = {};
					_.each( records, function( record ) {
						if ( record.data.InProgressDate !== null && record.data.AcceptedDate !== null ) {
							estimateEntry = {};
							estimateEntry.estimate = record.data.PlanEstimate;
							estimateEntry.id = record.data.FormattedID;
							estimateEntry.name = record.data.Name;
							estimateEntry.ref = record.data._ref;
							estimateEntry.cycleTime = app.countWeekDays( new Date( record.data.InProgressDate ), new Date( record.data.AcceptedDate ) );
							
							// Let's ignore cycle times less than .25 days as they reflect someone doing paperwork and moving work items very quickly
							if ( estimateEntry.cycleTime > 0.25 ) {
								if ( !( _.contains( Object.keys( estimateTimes ), estimateEntry.estimate.toString() ) ) ) {
									estimateTimes[ estimateEntry.estimate ] = [];
								}
								estimateTimes[ estimateEntry.estimate ].push( estimateEntry );
							}
						}
					}, app );
					app.prepareScatterChart( estimateTimes );
				}
			}
		});
	},
	
	// Organize the data for the cycle times by estimate scatter chart
	prepareScatterChart:function( estimateTimes ){
		if (Object.keys( estimateTimes ).length > 0) {
			var seriesData = [];
			seriesData.push( {} );
			seriesData[0].name = 'Stories';
			seriesData[0].data = [];
			_.each( estimateTimes, function( estimateLookup ) {
				_.each( estimateLookup, function( story ) {
					var point = {};
					point.x = story.estimate;
					point.y = story.cycleTime;
					point.tooltip = story.id + " - " + story.name + "<br/>Cycle Time: " + story.cycleTime + "d";
					// Store some additional data that, although not needed for the graph, we can use again later
					point.name = story.name;
					point.id = story.id;
					point.ref = story.ref;
					seriesData[0].data.push( point );
				}, app );
			}, app );
			app.drawScatterChart( seriesData, estimateTimes );
		} else {
			app.showNoDataBox();
		}
	},
	
	drawScatterChart:function( seriesData, estimateTimes ) {
		// Remove any existing components
		while( app.down( '*' ) ) {
			app.down( '*' ).destroy();
		}
		
		scatterChart = app.add({
			xtype: 'rallychart',
			storeConfig: {},
			chartConfig: {
				chart:{
					type: 'scatter',
					zoomType: 'xy'
				},
				legend: {
					enabled: true
				},
				xAxis: {
					title: {
						text: 'Plan Estimate'
					},
					tickInterval: 1,
					startOnTick: true,
					endOnTick: true,
					showLastLabel: true,
					min: 0
				},
				yAxis: {
					title: {
						text: 'Cycle Time (workdays)'
					},
					tickInterval: 1,
					min: 0,
					gridLineWidth: 0
				},
				title:{
					text: 'Cycle Time by Estimate'
				},
				tooltip: {
					useHTML: true,
					pointFormat: '{point.tooltip}',
					headerFormat: ''
				}
			},
			chartData: {
				series: seriesData
			} 
		});
		
		// Workaround bug in setting colors - http://stackoverflow.com/questions/18361920/setting-colors-for-rally-chart-with-2-0rc1/18362186
		var colors = [ "#61257a"];
		scatterChart.setChartColors( colors );
		
		app.add( {
			xtype: 'label',
			html: 'This graph shows your completed stories\' cycle times by estimate.*<br/>Click below to see how you can improve your estimates to be more consistent and predictable.<br/><br/>',
			style: {
				'font-size': '15px'
			}
		} );
		
		app.add( {
			xtype: 'rallybutton',
			text: 'Calibrate Estimates',
			id: 'calibrationbutton',
			handler: function(){ app.onCalibrateButton( estimateTimes ); },
			style: {
				'background-color': '#61257a',
				'border-color': '#61257a'
			}
		} );
		
		app.add( {
			xtype: 'label',
			html: '<a href="https://help.rallydev.com/sizing-and-estimates-overview">Learn about agile estimation</a>',
			style: {
				'font-size': '15px'
			}
		} );
		
		app.add( {
			xtype: 'label',
			html: '<br/><br/>* Only stories marked in-progress and accepted in this timebox are tracked. Stories with no estimate, an estimate of 0, or a cycle time of 0.25 days or less are ignored.',
			style: {
				'font-size': '9px'
			}
		} );
		
		this._myMask.hide();
	},
	
	// Create a box plot showing the distribution of cycle times for each estimate
	onCalibrateButton:function( estimateTimes ){
		var boxplots = [];
		var outliers = [];
		
		_.each( estimateTimes, function( values ) {
			values = values.sort(function(a, b){ return a.cycleTime - b.cycleTime; } );

			// Find our quartiles. Logic from http://thiruvikramangovindarajan.blogspot.com/2014/10/calculate-quartile-q1-q3-and-median-q2.html
			var Q1 = 0;
			var Q2 = 0;
			var Q3 = 0;
			var q1Arr = [];
			var q2Arr = [];
			var q3Arr = [];
			
			if ( values.length == 1 ) {
				q1Arr = q2Arr = q3Arr = values;
			} else {
				q1Arr = (values.length % 2 === 0) ? values.slice(0, (values.length / 2)) : values.slice(0, Math.floor(values.length / 2));
				q2Arr =  values;
				q3Arr = (values.length % 2 === 0) ? values.slice((values.length / 2), values.length) : values.slice(Math.ceil(values.length / 2), values.length);
			}
			
			Q1 = app.medianX(q1Arr);
			Q2 = app.medianX(q2Arr);
			Q3 = app.medianX(q3Arr);
			
			var interquartile_range = Q3 - Q1;
			
			// find lower outliers
			var min_index = 0;
			while( values[ min_index ].cycleTime < ( Q1 - ( app.OUTLIER_THRESHOLD * interquartile_range ) ) ) {
				outliers.push( [ boxplots.length, values[ min_index ].cycleTime ] );
				min_index++;
			}
			
			// find upper outliers
			var max_index = values.length - 1;
			while( values[ max_index ].cycleTime > ( Q3 + ( app.OUTLIER_THRESHOLD * interquartile_range ) ) ) {
				outliers.push( [ boxplots.length, values[ max_index ].cycleTime ] );
				max_index--;
			}
			
			var boxplotPoint = {};
			boxplotPoint.x = boxplots.length;
			boxplotPoint.low = values[ min_index ].cycleTime;
			boxplotPoint.q1 = Q1;
			boxplotPoint.median = Q2;
			boxplotPoint.q3 = Q3;
			boxplotPoint.high = values[ max_index ].cycleTime;
			boxplotPoint.count = max_index - min_index + 1;
			boxplotPoint.estimate = values[0].estimate;
			
			boxplots.push( boxplotPoint );
			
			// Save summary stats back into the Estimate Values for later access
			values.unshift( boxplotPoint );
		}, app );
		
		// Remove any existing components
		while( app.down( '*' ) ) {
			app.down( '*' ).destroy();
		}
		
		boxPlotChart = app.add({
			xtype: 'rallychart',
			storeConfig: {},
			chartConfig: {
				chart:{
					type: 'boxplot'
				},
				title:{
					text: 'Cycle Time by Plan Estimate'
				},
				xAxis: {
					title: {
						text: 'Plan Estimate (Points)'
					}
				},
				yAxis:{
					title: {
						text: 'Cycle Time (workdays)'
					},
					allowDecimals: false,
					min: 0,
					gridLineWidth: 0
				},
				plotOptions: {
					column: {
						pointPadding: 0.2,
						borderWidth: 0
					}
				}
			},
							
			chartData: {
				series: [
					{
						name: 'Cycle Time',
						data: boxplots,
						tooltip: {
							headerFormat: "<b>Estimate:</b> {point.x}<br/>",
							pointFormat: "<b>Maximum:</b> {point.high}<br/><b>Upper quartile:</b> {point.q3}<br/><b>Median:</b> {point.median}<br/><b>Lower quartile:</b> {point.q1}<br/><b>Minimum:</b> {point.low}<br/><b>Count:</b> {point.count}"
						}
					},
					{
						name: 'Outliers',
						type: 'scatter',
						data: outliers,
						tooltip: {
							pointFormat: '{point.y}'
						},
						marker: {
							symbol: 'circle'
						}
					} 
				],
				categories: Object.keys( estimateTimes )
			}
		});
		
		// Workaround bug in setting colors - http://stackoverflow.com/questions/18361920/setting-colors-for-rally-chart-with-2-0rc1/18362186
		var colors = [ "#61257a", "#61257a" ];
		boxPlotChart.setChartColors( colors );
		
		app.add( {
			xtype: 'label',
			html: 'Your data, displayed as a box plot, will help us identify which stories could benefit most from further analysis.<br/>First, let\'s find where you are already being consistent. We will use this as an anchor estimate to then form a basis for your other relative estimates.<br/><br/>',
			style: {
				'font-size': '15px'
			}
		} );
		
		app.add( {
			xtype: 'rallybutton',
			text: 'Identify Anchor Estimate',
			handler: function(){ app.onIdentifyAnchorButton( estimateTimes ); },
			style: {
				'background-color': '#61257a',
				'border-color': '#61257a'
			}
		} );
		
		app.add( {
			xtype: 'label',
			html: '<a href="https://www.khanacademy.org/math/probability/data-distributions-a1/box--whisker-plots-a1/v/reading-box-and-whisker-plots">Learn how to read box plots</a>',
			style: {
				'font-size': '15px'
			}
		} );
	},
	
	// Identify which estimate's cycle times are the most consistent 
	onIdentifyAnchorButton:function( estimateTimes ){
		var bestScore = 0;
		var bestEstimate;
		var bestX;
		var bestMedianCycleTime;
		_.each( estimateTimes, function( values ) {
			// The first element of each app estimates array should have the summary boxplot info
			boxplotSummary = values[0];
			var score = boxplotSummary.count / ( boxplotSummary.q3 - boxplotSummary.q1 );
			if ( score != Infinity ) {
				if ( score > bestScore ) {
					bestScore = score;
					bestX = boxplotSummary.x;
					bestEstimate = boxplotSummary.estimate;
					bestMedianCycleTime = boxplotSummary.median;
				}
			}
		});
		
		var chartData = boxPlotChart.getChartData();
		var chartConfig = boxPlotChart.getChartConfig();
		
		// Let's not color the outliers as it helps communicate that we're ignoring them
		chartData.series[0].data[bestX].color = '#d30606';
		boxPlotChart.refresh({
			chartData: chartData
		});
		
		while( app.down( 'label' ) ) {
			app.down( 'label' ).destroy();
		}
		while( app.down( 'button' ) ) {
			app.down( 'button' ).destroy();
		}
		
		app.add( {
			xtype: 'label',
			html: 'Stories with an estimate of ' + bestEstimate + ' had the best balance of a tight interquartile range and a large number of stories. Let\'s use this to set target relative cycle times for our estimates.<br/><br/>',
			style: {
				'font-size': '15px'
			}
		} );
		
		app.add( {
			xtype: 'rallybutton',
			text: 'Project Target Cycle Times',
			handler: function(){ app.onProjectTargetCycleTimesButton( bestEstimate, bestMedianCycleTime ); },
			style: {
				'background-color': '#61257a',
				'border-color': '#61257a'
			}
		} );
		
	},
	
	// Determine the ideal cycle time for each estimate and draw lines on the chart.
	onProjectTargetCycleTimesButton:function( bestEstimate, bestMedianCycleTime ) {
		var chartData = boxPlotChart.getChartData();
		var estimateTargets = {};
		
		// Create a line showing the ideal cycle time for each estimate
		var greyColor = 9;
		var boxplotData = chartData.series[0].data.slice(0).reverse();
		_.each( boxplotData, function( boxplot ) {
			var diff = boxplot.estimate / bestEstimate;
			var target = bestMedianCycleTime * diff;
			
			estimateTargets[ boxplot.estimate ] = target;
			
			var newSeries = {};
			newSeries.type = 'line';
			newSeries.name = 'Target Cycle Time for ' + boxplot.estimate + 's';
			newSeries.lineWidth = 2;
			newSeries.marker = {};
			newSeries.marker.enabled = false;
			newSeries.dashStyle = 'dash';

			newSeries.color = '#' + Array(7).join( parseInt( greyColor, 10 ).toString() );
			// Increment the grey color by a percentage of the overall hex spectrum to get a gradient
			// NOTE: Avoid hex letters to make it simpler and not be too light
			greyColor = greyColor - ( 9 / boxplotData.length );
			
			// The data is an array of the target, one for each estimate
			var dataArray = [];
			for( i = 0; i < boxplotData.length; i++ ){
				dataArray.push( {
					x: i,
					y: target
				});
			}
			newSeries.data = dataArray;
			
			chartData.series.unshift( newSeries );
		});
		
		boxPlotChart.refresh({
			chartData: chartData
		});
	
		while( app.down( 'label' ) ) {
			app.down( 'label' ).destroy();
		}
		while( app.down( 'button' ) ) {
			app.down( 'button' ).destroy();
		}
		
		app.add( {
			xtype: 'label',
			html: 'Taking these target cycle times, let\'s apply them back to our individual story cycle times to see if there are ways to better estimate your work.<br/><br/>',
			style: {
				'font-size': '15px'
			}
		} );
		
		app.add( {
			xtype: 'rallybutton',
			text: 'Identify Opportunities for Improvement',
			handler: function(){ app.onIdentifyImprovements( estimateTargets ); },
			style: {
				'background-color': '#61257a',
				'border-color': '#61257a'
			}
		} );
	},
	
	// Create bands for min and max cycle times per estimate, and identify the top 5 stories out of the bands
	onIdentifyImprovements:function( estimateTargets ) {
		// Remove any existing components
		while( app.down( '*' ) ) {
			app.down( '*' ).destroy();
		}
		
		// Create lookup for estimate by cycle time
		var minEstimateSeriesData = [];
		var maxEstimateSeriesData = [];
		_.each( _.keys( estimateTargets ), function( estimate ) {
			var diff;
			if( _.isEmpty( minEstimateSeriesData ) ) {
				var nextEstimate = _.keys( estimateTargets )[ _.keys( estimateTargets ).indexOf( estimate ) + 1 ];
				diff = ( estimateTargets[ nextEstimate ] - estimateTargets[ estimate ] ) * ( 1 - ( estimate / nextEstimate ) );
			} else {
				var priorEstimate = _.keys( estimateTargets )[ _.keys( estimateTargets ).indexOf( estimate ) - 1 ];
				diff = ( estimateTargets[ estimate ] - estimateTargets[ priorEstimate ] ) * ( priorEstimate / estimate );
			}
			
			var minTargetCycleTime = estimateTargets[ estimate ] - diff;
			minEstimateSeriesData.push( {
				x: estimate,
				y: minTargetCycleTime,
				tooltip: 'Minimum Target Cycle Time: ' + minTargetCycleTime
			});
			var maxTargetCycleTime = estimateTargets[ estimate ] + diff;
			maxEstimateSeriesData.push( {
				x: estimate,
				y: maxTargetCycleTime,
				tooltip: 'Maximum Target Cycle Time: ' + maxTargetCycleTime
			});
		});
		
		var minCycleTimes = {
			type: 'line',
			name: 'Min Target Cycle Times',
			data: minEstimateSeriesData,
			lineWidth: 2,
			marker: {
				enabled: false
			},
			color:'#ad3408'
		};
		
		var maxCycleTimes = {
			type: 'line',
			name: 'Max Target Cycle Times',
			data: maxEstimateSeriesData,
			lineWidth: 2,
			marker: {
				enabled: false
			},
			color:'#ad3408'
		};
		
		chartData = scatterChart.getChartData();
		
		var issues = [];
		_.each( chartData.series[0].data, function( scatterPoint ) {
			var target;
			var maxEstimateSeriesIndex = _.findKey( maxEstimateSeriesData, function(v) { return v.y > scatterPoint.y; });
			if ( maxEstimateSeriesIndex !== undefined ) {
				target = maxEstimateSeriesData[ maxEstimateSeriesIndex ].x;
			} else {
				target = undefined;
			}
			
			if( target === undefined ) {
				// Set an arbitrarily high score for stories whose estimates are above the current team's scale, as we don't know how bad they are.
				// Subtract the point's estimate as smaller estimates that are off the scale are worst
				scatterPoint.issueScore = 1000 - scatterPoint.x;
			} else {
				scatterPoint.issueScore = Math.abs( scatterPoint.x - target ) ;
			}
			// Include the cycle time in the math to break ties
			// TODO: This could be smarter by looking for the cycle time farthest from the median
			scatterPoint.issueScore += ( scatterPoint.y / 1000 );
			
			scatterPoint.tooltip += '<br/>Estimate: ' + scatterPoint.x + '<br/>Target Estimate: ';
			if( target !== undefined ) {
				scatterPoint.tooltip += target;
			} else {
				scatterPoint.tooltip += '>' + maxEstimateSeriesData[ maxEstimateSeriesData.length - 1 ].x;
			}
			scatterPoint.target = target;
			
			if( scatterPoint.x != target ) {
				scatterPoint.color = '#61257a';
			} else {
				scatterPoint.color = '#d30606';
			}
		});
		chartData.series[0].marker = {};
		chartData.series[0].marker.symbol = 'circle';
		
		var rankedIssues = _.sortBy( chartData.series[0].data, function(point){ return point.issueScore; });
		rankedIssues.reverse();
		
		var worstIssues = [];
		for( i = 0; i < 5; i++ ) {
			var tooltipMatch = rankedIssues[ i ].tooltip;
			for( j = 0; j < chartData.series[0].data.length; j++ ) {
				scatterPoint = chartData.series[0].data[j];
				if( scatterPoint.tooltip == tooltipMatch ) {
					scatterPoint.marker = {};
					scatterPoint.marker.symbol = 'diamond';
					scatterPoint.color = '#3300ff';
					
					var targetString;
					if( scatterPoint.target !== undefined ) {
						targetString = scatterPoint.target.toString();
					} else {
						targetString = '>' + maxEstimateSeriesData[ maxEstimateSeriesData.length - 1 ].x;
					}
					
					worstIssues.push( [ 
						// TODO: See if we can get the nice formatted ID renderer to work
						/*{ 
							FormattedID: scatterPoint.id,
							_ref: scatterPoint.ref
						},*/
						scatterPoint.id,
						scatterPoint.name,
						scatterPoint.y,
						scatterPoint.x,
						targetString
					]);
				}
			}
		}
		
		var worstIssuesStore = Ext.create('Ext.data.ArrayStore', {
			storeId: 'worstIssues',
			fields: [
				{ name: 'formattedId', type: 'string' },
				{ name: 'name', type: 'string' },
				{ name: 'cycleTime', type: 'float' },
				{ name: 'estimate', type: 'integer' },
				{ name: 'targetEstimate', type: 'string' }
			],
			data: worstIssues
		});
		
		chartData.series.unshift( maxCycleTimes );
		chartData.series.unshift( minCycleTimes );
		
		// Reshow our scatter plot
		app.add( Ext.merge( scatterChart.initialConfig, chartData ) );
		
		app.add( {
			xtype: 'label',
			html: 'On the scatter plot of cycle times by estimate, we now have lines to note the minimum and maximum cycle times for each estimate. The five stories that need the most readjustment have been marked in blue diamonds, and listed below:<br/><br/>',
			style: {
				'font-size': '15px'
			}
		} );
		
		app.add( {
			xtype: 'rallygrid',
			showPagingToolbar: false,
			showRowActionsColumn: false,
			editable: false,
			store: worstIssuesStore,
			columnCfgs: [
				{
				// TODO: Get this to use the nice formattedID renderer
				//	xtype: 'templatecolumn',
				//	tpl: Ext.create('Rally.ui.renderer.template.FormattedIDTemplate'),
					text: 'ID',
					dataIndex: 'formattedId',
					flex: true
				},
				{
					text: 'Name',
					dataIndex: 'name',
					flex: true
				},
				{
					text: 'Cycle Time',
					dataIndex: 'cycleTime',
					flex: true
				},
				{
					text: 'Estimate',
					dataIndex: 'estimate',
					flex: true
				},
				{
					text: 'Target Estimate',
					dataIndex: 'targetEstimate',
					flex: true
				}
			]
		});
		
		app.add( {
			xtype: 'label',
			html: '<br/>',
			style: {
				'font-size': '15px'
			}
		} );
		
		app.add( {
			xtype: 'rallybutton',
			text: 'Brainstorm Actions to Realign Estimates',
			handler: function(){ app.onBrainstormActions(); },
			style: {
				'background-color': '#61257a',
				'border-color': '#61257a'
			}
		} );
	},
	
	onBrainstormActions:function(){
		while( app.down( 'label' ) ) {
			app.down( 'label' ).destroy();
		}
		while( app.down( 'button' ) ) {
			app.down( 'button' ).destroy();
		}
		while( app.down( 'rallychart' ) ) {
			app.down( 'rallychart' ).destroy();
		}
		
		app.add( {
			xtype: 'label',
			html: 'What actions could you take to better estimate stories like these? Some questions to spark discussion:<br/><ul><li>What, had you known it sooner, would have changed your estimate? How could you have know sooner?</li><li>Could this work have been broken down into smaller stories?</li><li>What risks manifested during this work? Could they have been avoided or mitigated?</li><li>Did emergency work cause you to put this work on hold? If so, was it the right decision to change priorities?</li><li>Are there patterns or similarities to this work that you could watch for in future estimations?</li></ul>Please enter actions you could take in the future to better estimate the effort for stories like these in the future.<br/><br/>NOTE: These actions are not currently saved, so make a copy for later if you\'d like. You could even save reminders as a template for future stories.',
			style: {
				'font-size': '15px'
			}
		} );
		
		app.add( {
			xtype: 'textareafield',
			grow: true,
			name: 'actionItems',
			anchor: '100%',
			width: '100%'
		} );
		
		app.add( {
			xtype: 'label',
			html: '<br/>Congrats in advance for committing to these action items and making your estimates more consistent and predictable. Hopefully you\'ll check back after they\'re implemented to see how your cycle times have changed and identify your next actions for continual improvement.',
			style: {
				'font-size': '15px'
			}
		} );
	},
	
	showNoDataBox:function(){
		app._myMask.hide();
		app.add({
			xtype: 'label',
			text: 'There is no data. Check if there are stories with PlanEstimate assigned to your selected timebox which were marked in-progress and accepted within the timebox.'
		});
	},
	
	medianX:function( medianArr ) {
		count = medianArr.length;
		median = (count % 2 === 0) ? (medianArr[(medianArr.length/2) - 1].cycleTime + medianArr[(medianArr.length / 2)].cycleTime ) / 2 : medianArr[Math.floor(medianArr.length / 2)].cycleTime;
		return median;
	},
	
	countWeekDays:function( dDate1, dDate2 ) {
		var days = 0;
		var dateItr = dDate1;
		
		while( dateItr < dDate2 ) {
			dateItr.setHours( dateItr.getHours() + 6 );
			// if the new day is a weekend, don't count it
			// TODO: be locale aware and DST aware
			if( ( dateItr.getDay() != 6 ) && ( dateItr.getDay() !== 0 ) ) {
				days = days + 0.25;
			} 
		}
		return days;
	}
});