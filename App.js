Ext.define('CustomApp', {
    extend: 'Rally.app.TimeboxScopedApp',
    scopeType: 'release',
	filters: [],
    pagesize: 2000,
    estimateTimes: {},
    OUTLIER_THRESHOLD: 1.5,
    
    onScopeChange: function( scope ) {
		this.callParent( arguments );
		this.fetchWorkItems( scope );
	},
    
    fetchWorkItems:function( scope ){
		// Show loading message
        this._myMask = new Ext.LoadMask(Ext.getBody(), {msg:"Calculating...Please wait."});
        this._myMask.show();
        
        // Remove any existing chart
        if( this.down( 'rallychart' ) ) {
			this.down( 'rallychart' ).destroy();
        }
        
        // Remove any 'no data' message that was shown
        if( this.down( 'label' ) ) {
			this.down( 'label' ).destroy();
        }
    
        this.filters = [];
        this.estimateTimes = {};
        
        // Look for stories that were started and accepted within the release timebox	
        this.filters = [];
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
        
        this.filters.push( startDateFilter );
        this.filters.push( endDateFilter );
        this.filters.push( estimateFilter );

		var dataScope = this.getContext().getDataContext();
		var store = Ext.create(
			'Rally.data.wsapi.Store',
			{
				model: 'UserStory',
				fetch: ['InProgressDate','AcceptedDate','PlanEstimate'],
				context: dataScope,
				pageSize: this.pagesize,
				limit: this.pagesize,
				sorters:[{
					property:'PlanEstimate',
					direction: 'ASC'
				}]
			},
			this
        );

        store.addFilter(this.filters,false);
        store.loadPage(1, {
            scope: this,
            callback: function( records, operation ) {
                if( operation.wasSuccessful() ) {
                    _.each( records, function( record ) {
						if ( record.data.InProgressDate !== null && record.data.AcceptedDate !== null ) {
							var estimate = record.data.PlanEstimate;
							var cycleTime = this.countWeekDays( new Date( record.data.InProgressDate ), new Date( record.data.AcceptedDate ) );

							if ( !( _.contains( Object.keys( this.estimateTimes ), estimate.toString() ) ) ) {
								this.estimateTimes[ estimate ] = [];
							}
							this.estimateTimes[ estimate ].push( cycleTime );
                        }
                    }, this );
                    this.prepareChart();
                }
            }
        });
    },
  
    prepareChart:function(){
        if (Object.keys( this.estimateTimes ).length > 0) {
            var categories = Object.keys( this.estimateTimes );
            var boxplots = [];
            var outliers = [];
            
			_.each( this.estimateTimes, function( values ) {
				values = values.sort(function(a, b){ return a - b; } );

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
				
				Q1 = this.medianX(q1Arr);
				Q2 = this.medianX(q2Arr);
				Q3 = this.medianX(q3Arr);
				
				var interquartile_range = Q3 - Q1;
				// find lower outliers
				var min_index = 0;
				while( values[ min_index ] < ( Q1 - ( this.OUTLIER_THRESHOLD * interquartile_range ) ) ) {
					outliers.push( [ boxplots.length, values[ min_index ] ] );
					min_index++;
				}
				
				// find upper outliers
				var max_index = values.length - 1;
				while( values[ max_index ] > ( Q3 + ( this.OUTLIER_THRESHOLD * interquartile_range ) ) ) {
					outliers.push( [ boxplots.length, values[ max_index ] ] );
					max_index--;
				}
				
				boxplots.push( [ values[ min_index ], Q1, Q2, Q3, values[ max_index ] ] );
            }, this );

            this.makeChart( boxplots, outliers, categories );
        }
        else{
            this.showNoDataBox();
        }
    },
    
    makeChart:function( boxplots, outliers, categoriesData){
       // see http://www.highcharts.com/demo/box-plot for good examples
        this._myMask.hide();
        if( this.down( 'rallychart' ) ) {
			this.down( 'rallychart' ).destroy();
        }
        var chart = this.add({
            xtype: 'rallychart',
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
                        text: 'Cycle Time (Days)'
                    },
                    allowDecimals: false,
                    min : 0
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
						name: 'Cycle Time (Days)',
						data: boxplots
					},
					{
						name: 'Outliers (Days)',
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
        var colors = [ "#392351", "#392351" ];
        chart.setChartColors( colors );
    },
    
    showNoDataBox:function(){
        this._myMask.hide();
        this.add({
			xtype: 'label',
			text: 'There is no data. Check if there are iterations in scope and work items with PlanEstimate assigned for iterations'
        });
    },
    
    medianX:function(medianArr) {
		count = medianArr.length;
		median = (count % 2 === 0) ? (medianArr[(medianArr.length/2) - 1] + medianArr[(medianArr.length / 2)]) / 2:medianArr[Math.floor(medianArr.length / 2)];
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