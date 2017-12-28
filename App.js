var app = null;
var scatterChart;
var boxPlotChart;

Ext.define('CustomApp', {
    extend: 'Rally.app.TimeboxScopedApp',
    scopeType: 'release',
    pagesize: 2000,
    estimateTimes: {},
    OUTLIER_THRESHOLD: 1.5,
    
    onScopeChange: function( scope ) {
		app = this;
		app.callParent( arguments );
		app.fetchWorkItems( scope );
	},
    
    fetchWorkItems:function( scope ){
		// Show loading message
        app._myMask = new Ext.LoadMask(Ext.getBody(), {msg:"Calculating...Please wait."});
        app._myMask.show();
        
        // Remove any existing components
        while( app.down( '*' ) ) {
			app.down( '*' ).destroy();
        }
    
        app.filters = [];
        app.estimateTimes = {};
        
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
             operator: '!=',
             value: 'null'
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
				pageSize: app.pagesize,
				limit: app.pagesize,
				sorters:[{
					property:'PlanEstimate',
					direction: 'ASC'
				}]
			},
			app
        );

        store.addFilter( filters, false );
        store.loadPage(1, {
            scope: app,
            callback: function( records, operation ) {
                if( operation.wasSuccessful() ) {
                    _.each( records, function( record ) {
						if ( record.data.InProgressDate !== null && record.data.AcceptedDate !== null ) {
							estimateEntry = {};
							estimateEntry.estimate = record.data.PlanEstimate;
							estimateEntry.id = record.data.FormattedID;
							estimateEntry.name = record.data.Name;
							estimateEntry.cycleTime = app.countWeekDays( new Date( record.data.InProgressDate ), new Date( record.data.AcceptedDate ) );
							
							// Let's ignore cycle times of 0 days as they reflect someone doing paperwork
							if ( estimateEntry.cycleTime > .25 ) {
								if ( !( _.contains( Object.keys( app.estimateTimes ), estimateEntry.estimate.toString() ) ) ) {
									app.estimateTimes[ estimateEntry.estimate ] = [];
								}
								app.estimateTimes[ estimateEntry.estimate ].push( estimateEntry );
							}
                        }
                    }, app );
                    app.prepareScatterChart();
                }
            }
        });
    },
    
    prepareScatterChart:function(){
    	if (Object.keys( app.estimateTimes ).length > 0) {
    		var seriesData = [];
    		seriesData.push( {} );
    		seriesData[0].name = 'Work Items';
    		seriesData[0].data = [];
    		_.each( app.estimateTimes, function( values ) {
    			_.each( values, function( story ) {
					var point = {};
					point.x = story.estimate;
					point.y = story.cycleTime;
					point.tooltip = story.id + " - " + story.name + "<br/>Cycle Time: " + story.cycleTime + "d";
					seriesData[0].data.push( point );
				}, app );
			}, app );
			app.drawScatterChart( seriesData );
    	} else {
            app.showNoDataBox();
        }
	},
	
	drawScatterChart:function( seriesData ) {
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
					showLastLabel: true
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
			html: 'This graph shows your completed work\'s cycle time by estimate.*<br/>Click below to see how you can improve your estimates to be more consistent and predictable.<br/><br/>',
			style: {
				'font-size': '15px'
			}
		} );
		
		app.add( {
			xtype: 'rallybutton',
			text: 'Calibrate Estimates',
			id: 'calibrationbutton',
			handler: function(){ app.onCalibrateButton(); },
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
			html: '<br/><br/>* Only work items started in progress and accepted in this release are tracked. Work items with a cycle time of .25days or less are ignored.',
			style: {
				'font-size': '9px'
			}
		} );
		
		this._myMask.hide();
	},
	
	onCalibrateButton:function(){
		var categories = Object.keys( app.estimateTimes );
		var boxplots = [];
		var outliers = [];
		
		_.each( app.estimateTimes, function( values ) {
			values = values.sort(function(a, b){ return a.cycleTime - b.cycleTime; } );

			// logic from http://thiruvikramangovindarajan.blogspot.com/2014/10/calculate-quartile-q1-q3-and-median-q2.html
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
		app.makeBoxPlot( boxplots, outliers, categories );
    },
    
    makeBoxPlot:function( boxplots, outliers, categoriesData){
		// see http://www.highcharts.com/demo/box-plot for good examples
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
						}
					} 
                ],
                categories: categoriesData
            }
          
        });
        
        // Workaround bug in setting colors - http://stackoverflow.com/questions/18361920/setting-colors-for-rally-chart-with-2-0rc1/18362186
        var colors = [ "#61257a", "#61257a" ];
        boxPlotChart.setChartColors( colors );
        
        app.add( {
			xtype: 'label',
			html: 'Your data, displayed as a box plot, will help us identify which work items could benefit most from further analysis<br/>First, let\'s identify which estimate is most consitent. We will use this to then form a basis for your other estimates.<br/><br/>',
			style: {
				'font-size': '15px'
			}
		} );
		
		app.add( {
			xtype: 'rallybutton',
			text: 'Identify Anchor Estimate',
			handler: function(){ app.onIdentifyAnchorButton(); },
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
    
    onIdentifyAnchorButton:function(){
    	var bestScore = 0;
    	var bestEstimate;
    	var bestX;
    	var bestMedianCycleTime;
    	_.each( app.estimateTimes, function( values ) {
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
        
        chartData.series[0].data[bestX].color = '#d30606';
        // TODO: Should we color the outliers data too?
        boxPlotChart.refresh({
        	chartData: chartData
        });
        
        while( app.down( 'label' ) ) {
			app.down( 'label' ).destroy();
        };
        while( app.down( 'button' ) ) {
			app.down( 'button' ).destroy();
        };
        
        app.add( {
			xtype: 'label',
			html: 'Work items with an estimate of ' + bestEstimate + ' had the best balance of a tight interquartile range and a large number of work items. Let\'s use this to set target relative cycle times for our estimates.<br/><br/>',
			style: {
				'font-size': '15px'
			}
		} );
		
		app.add( {
			xtype: 'rallybutton',
			text: 'Project Target Cycle Times',
			handler: function(){ app.onProjectCycleTimesButton( bestEstimate, bestMedianCycleTime ); },
			style: {
				'background-color': '#61257a',
				'border-color': '#61257a'
			}
        } );
        
    },
    
    onProjectCycleTimesButton:function( bestEstimate, bestMedianCycleTime ) {
    	var chartData = boxPlotChart.getChartData();
    	var estimateTargets = {};
        
        _.each( chartData.series[0].data.reverse(), function( boxplot ) {
        	var diff = boxplot.estimate / bestEstimate;
        	var target = bestMedianCycleTime * diff;
        	
        	estimateTargets[ boxplot.estimate ] = target;
        	
        	var newSeries = {};
			newSeries.type = 'spline';
			newSeries.name = 'Target Cycle Time for ' + boxplot.estimate + 's';
			newSeries.data = Array.apply( null, Array( chartData.series[0].data.length )).map( Number.prototype.valueOf, target );
			newSeries.lineWidth = 2;
			newSeries.marker = {};
			newSeries.marker.enabled = false;
			newSeries.color = '#ad3408';
			
			chartData.series.unshift( newSeries );
        });
        
    	boxPlotChart.refresh({
        	chartData: chartData
        });
    
    	while( app.down( 'label' ) ) {
			app.down( 'label' ).destroy();
        };
        while( app.down( 'button' ) ) {
			app.down( 'button' ).destroy();
        };
        
        app.add( {
			xtype: 'label',
			html: 'Taking these target cycle times, let\'s apply them back to our individual work item cycle times to see if there are ways to better estimate your work.<br/><br/>',
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
    		
    		minEstimateSeriesData.push( { x: estimate, y: estimateTargets[ estimate ] - diff } );
    		maxEstimateSeriesData.push( { x: estimate, y: estimateTargets[ estimate ] + diff } );
        });
                
        var minCycleTimes = {};
		minCycleTimes.type = 'spline';
		minCycleTimes.name = 'Min Target Cycle Times';
		minCycleTimes.data = minEstimateSeriesData;
		minCycleTimes.lineWidth = 2;
		minCycleTimes.marker = {};
		minCycleTimes.marker.enabled = false;
		minCycleTimes.color = '#ad3408';
		
		var maxCycleTimes = {};
		maxCycleTimes.type = 'spline';
		maxCycleTimes.name = 'Max Target Cycle Times';
		maxCycleTimes.data = maxEstimateSeriesData;
		maxCycleTimes.lineWidth = 2;
		maxCycleTimes.marker = {};
		maxCycleTimes.marker.enabled = false;
		maxCycleTimes.color = '#ad3408';
        
        chartData = scatterChart.getChartData();
        
        var issues = [];
        _.each( chartData.series[0].data, function( scatterPoint ) {
        	var target;
        	var maxEstimateSeriesIndex = _.findKey( maxEstimateSeriesData, function(v) { return v.y > scatterPoint.y; });
        	if ( maxEstimateSeriesIndex != undefined ) {
            	target = maxEstimateSeriesData[ maxEstimateSeriesIndex ].x;
            } else {
            	target = undefined;
            }
        	
        	scatterPoint.issueScore = Math.abs( scatterPoint.x - target );
        	scatterPoint.tooltip += '<br/>Estimate: ' + scatterPoint.x + '<br/>Target Estimate: ' + target;
        	
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
        for( i = 0; i < 6; i ++ ) {
        	var tooltipMatch = rankedIssues[ i ].tooltip;
        	_.each( chartData.series[0].data, function( scatterPoint ) {
        		if( scatterPoint.tooltip == tooltipMatch ) {
        			scatterPoint.marker = {};
        			scatterPoint.marker.symbol = 'diamond';
        			scatterPoint.color = '#3300ff';
        			worstIssues.push( scatterPoint );
        		}
        	});
        }
        console.log( worstIssues );
        
        chartData.series.unshift( maxCycleTimes );
        chartData.series.unshift( minCycleTimes );
        
        // Reshow our scatter plot
        app.add( Ext.merge( scatterChart.initialConfig, chartData ) );
    },
    
    showNoDataBox:function(){
        app._myMask.hide();
        app.add({
			xtype: 'label',
			text: 'There is no data. Check if there are iterations in scope and work items with PlanEstimate assigned for iterations'
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